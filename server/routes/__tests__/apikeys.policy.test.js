jest.mock('../../modules/apiKeyModule', () => ({
  updateApiKey: jest.fn(),
  serializeApiKey: jest.fn((key) => ({ id: key.id, name: key.name, key_prefix: key.key_prefix })),
}));

const express = require('express');
const request = require('supertest');
const apiKeyModule = require('../../modules/apiKeyModule');
const createApiKeyRoutes = require('../apikeys');

function createApp(authType = 'session') {
  const app = express();
  app.use(express.json());
  app.use(createApiKeyRoutes({ verifyToken: (req, _res, next) => {
    req.authType = authType;
    next();
  } }));
  return app;
}

describe('PATCH /api/keys/:id policy management', () => {
  beforeEach(() => jest.clearAllMocks());

  test('is session-only', async () => {
    await request(createApp('api_key')).patch('/api/keys/1').send({ policy: { role: 'view' } })
      .expect(403, { error: 'API keys cannot manage other API keys' });
  });

  test('rejects invalid policy validation errors', async () => {
    apiKeyModule.updateApiKey.mockRejectedValue(new Error('Invalid API key role'));
    await request(createApp()).patch('/api/keys/1').send({ policy: { role: 'bogus' } })
      .expect(400, { error: 'Invalid API key role' });
  });

  test('uses the shared serializer so key_hash is absent from PATCH responses', async () => {
    apiKeyModule.updateApiKey.mockResolvedValue({ id: 1, name: 'Safe', key_prefix: '12345678', key_hash: 'never-send' });
    const response = await request(createApp()).patch('/api/keys/1').send({ policy: { role: 'view' } }).expect(200);
    expect(response.body.key).toEqual({ id: 1, name: 'Safe', key_prefix: '12345678' });
    expect(response.body.key).not.toHaveProperty('key_hash');
  });
});
