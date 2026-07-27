jest.mock('../../models/apikey', () => ({
  count: jest.fn(), create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
}));
jest.mock('../../logger', () => ({ info: jest.fn(), debug: jest.fn() }));

const ApiKey = require('../../models/apikey');
const apiKeyModule = require('../apiKeyModule');

describe('external API key policies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates legacy-compatible keys when policy is omitted', async () => {
    ApiKey.count.mockResolvedValue(0);
    ApiKey.create.mockResolvedValue({ id: 1, name: 'Legacy' });
    const created = await apiKeyModule.createApiKey('Legacy');
    expect(created).toMatchObject({ id: 1, name: 'Legacy' });
    expect(ApiKey.create.mock.calls[0][0].role).toBeUndefined();
  });

  test('strictly validates policy fields and defaults', async () => {
    expect(() => apiKeyModule.validatePolicy({ role: 'view', unsupported: true })).toThrow('Unsupported');
    expect(() => apiKeyModule.validatePolicy({ role: 'view', maxRatingLevel: 5 })).toThrow('maxRatingLevel');
    expect(() => apiKeyModule.validatePolicy({ role: 'view', allowedMediaTypes: ['audio'] })).toThrow('allowedMediaTypes');
    expect(apiKeyModule.validatePolicy({ role: 'view' })).toEqual(expect.objectContaining({
      role: 'view', max_rating_level: 4, allowed_media_types: ['video'],
    }));
    expect(apiKeyModule.validatePolicy({
      role: 'view', allowedMediaTypes: ['video', 'short', 'livestream'],
    }).allowed_media_types).toEqual(['video', 'short', 'livestream']);
  });

  test('updates an existing key policy', async () => {
    const key = { id: 1, name: 'External', key_hash: 'must-not-leak', key_prefix: '12345678', update: jest.fn().mockResolvedValue() };
    ApiKey.findByPk.mockResolvedValue(key);
    const result = await apiKeyModule.updateApiKey(1, { role: 'request' });
    expect(result).toEqual(expect.objectContaining({ id: 1, name: 'External', key_prefix: '12345678' }));
    expect(result).not.toHaveProperty('key_hash');
    expect(key.update).toHaveBeenCalledWith(expect.objectContaining({ role: 'request' }));
  });

  test('uses the management response contract for lists without key hashes', async () => {
    ApiKey.findAll.mockResolvedValue([{ id: 1, name: 'Safe', key_hash: 'must-not-leak', key_prefix: '12345678' }]);
    await expect(apiKeyModule.listApiKeys()).resolves.toEqual([
      { id: 1, name: 'Safe', key_prefix: '12345678' },
    ]);
  });

  test('omits soft-revoked keys from the operational list while retaining storage records', async () => {
    const key = { id: 1, name: 'Revoked', key_prefix: '12345678', revoked_at: null, update: jest.fn().mockResolvedValue() };
    ApiKey.findByPk.mockResolvedValue(key);
    await apiKeyModule.deleteApiKey(1);
    ApiKey.findAll.mockResolvedValue([]);
    await expect(apiKeyModule.listApiKeys()).resolves.toEqual([]);
    expect(ApiKey.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { is_active: true, revoked_at: null },
    }));
    expect(key.update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(Date) }));
  });

  test('soft revokes instead of deleting', async () => {
    const key = { id: 1, name: 'Compromised', key_prefix: '12345678', revoked_at: null, update: jest.fn().mockResolvedValue() };
    ApiKey.findByPk.mockResolvedValue(key);
    await expect(apiKeyModule.deleteApiKey(1)).resolves.toBe(true);
    expect(key.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false, revoked_at: expect.any(Date) }));
    expect(ApiKey.destroy).toBeUndefined();
  });
});
