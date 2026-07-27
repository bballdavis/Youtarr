'use strict';

const migration = require('../20260726130000-create-api-key-channel-grants');

function queryInterface(existing = false) {
  const operations = [];
  return {
    operations,
    showAllTables: jest.fn().mockResolvedValue(existing ? ['api_key_channel_grants'] : []),
    showIndex: jest.fn().mockResolvedValue([]),
    createTable: jest.fn(async (table, columns) => operations.push(['create', table, columns])),
    addIndex: jest.fn(async (_table, fields, options) => operations.push(['index', fields, options])),
    dropTable: jest.fn(async (table) => operations.push(['drop', table])),
  };
}

describe('API key channel grants migration', () => {
  const Sequelize = { INTEGER: 'INTEGER', DATE: 'DATE', NOW: 'NOW' };

  test('creates normalized foreign keys and a unique grant pair', async () => {
    const qi = queryInterface();
    await migration.up(qi, Sequelize);
    const create = qi.operations.find(([operation]) => operation === 'create');
    expect(create[2].api_key_id.references).toEqual({ model: 'ApiKeys', key: 'id' });
    expect(create[2].channel_id.references).toEqual({ model: 'channels', key: 'id' });
    expect(create[2].api_key_id.onDelete).toBe('CASCADE');
    expect(qi.operations).toContainEqual([
      'index',
      ['api_key_id', 'channel_id'],
      { unique: true, name: 'api_key_channel_grants_key_channel_uq' },
    ]);
  });

  test('rollback only removes the allow-list and therefore fails closed', async () => {
    const qi = queryInterface(true);
    await migration.down(qi);
    expect(qi.operations).toEqual([['drop', 'api_key_channel_grants']]);
  });
});
