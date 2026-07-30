'use strict';

const {
  addColumnIfMissing,
  removeColumnIfExists,
  createTableIfNotExists,
  dropTableIfExists,
  addIndexIfMissing,
} = require('./helpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'max_active_jobs', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 5,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'hourly_write_limit', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 30,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'daily_write_limit', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 200,
    });

    await createTableIfNotExists(queryInterface, 'external_api_usage_buckets', {
      id: {
        type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false,
      },
      api_key_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ApiKeys', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      window_type: { type: Sequelize.STRING(8), allowNull: false },
      window_start: { type: Sequelize.DATE, allowNull: false },
      accepted_writes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await addIndexIfMissing(
      queryInterface,
      'external_api_usage_buckets',
      ['api_key_id', 'window_type', 'window_start'],
      { unique: true, name: 'external_api_usage_key_window_uq' }
    );
    await addIndexIfMissing(
      queryInterface,
      'external_api_usage_buckets',
      ['window_start'],
      { name: 'external_api_usage_window_idx' }
    );
  },

  async down(queryInterface) {
    await dropTableIfExists(queryInterface, 'external_api_usage_buckets');
    for (const column of [
      'daily_write_limit',
      'hourly_write_limit',
      'max_active_jobs',
    ]) {
      await removeColumnIfExists(queryInterface, 'ApiKeys', column);
    }
  },
};
