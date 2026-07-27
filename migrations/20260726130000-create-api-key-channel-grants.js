'use strict';

const {
  createTableIfNotExists,
  dropTableIfExists,
  addIndexIfMissing,
} = require('./helpers');

/**
 * Explicit allow-list linking external API keys to enabled Youtarr channels.
 * An absent row means no access.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'api_key_channel_grants', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
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
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    }, { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' });

    await addIndexIfMissing(
      queryInterface,
      'api_key_channel_grants',
      ['api_key_id', 'channel_id'],
      { unique: true, name: 'api_key_channel_grants_key_channel_uq' }
    );
    await addIndexIfMissing(
      queryInterface,
      'api_key_channel_grants',
      ['channel_id'],
      { name: 'api_key_channel_grants_channel_idx' }
    );
  },

  async down(queryInterface) {
    // Dropping the allow-list removes access; it cannot broaden access.
    await dropTableIfExists(queryInterface, 'api_key_channel_grants');
  },
};
