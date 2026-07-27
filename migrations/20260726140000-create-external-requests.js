'use strict';

const {
  createTableIfNotExists,
  dropTableIfExists,
  addIndexIfMissing,
} = require('./helpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'external_requests', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      },
      api_key_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ApiKeys', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      channel_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'channels', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      youtube_id: { type: Sequelize.STRING(32), allowNull: false },
      request_type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'video' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      active_dedupe_key: { type: Sequelize.STRING(191), allowNull: true },
      idempotency_hash: { type: Sequelize.STRING(64), allowNull: true },
      job_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'Jobs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      message: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
    }, { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' });

    await addIndexIfMissing(queryInterface, 'external_requests', ['active_dedupe_key'], {
      unique: true,
      name: 'external_requests_active_dedupe_uq',
    });
    await addIndexIfMissing(queryInterface, 'external_requests', ['api_key_id', 'idempotency_hash'], {
      unique: true,
      name: 'external_requests_key_idempotency_uq',
    });
    await addIndexIfMissing(queryInterface, 'external_requests', ['api_key_id', 'created_at'], {
      name: 'external_requests_key_created_idx',
    });
    await addIndexIfMissing(queryInterface, 'external_requests', ['api_key_id', 'status'], {
      name: 'external_requests_key_status_idx',
    });
    await addIndexIfMissing(
      queryInterface,
      'external_requests',
      ['api_key_id', 'request_type', 'youtube_id', 'created_at', 'id'],
      { name: 'external_requests_catalog_status_idx' }
    );
  },

  async down(queryInterface) {
    // Removing this table removes request history and cannot grant catalog or
    // download access. API routes fail closed when the schema is absent.
    await dropTableIfExists(queryInterface, 'external_requests');
  },
};
