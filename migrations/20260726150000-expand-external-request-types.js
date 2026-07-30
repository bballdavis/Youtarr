'use strict';

const {
  addColumnIfMissing,
  removeColumnIfExists,
  addIndexIfMissing,
  removeIndexIfExists,
} = require('./helpers');

const CHANNEL_FOREIGN_KEY = 'external_requests_channel_fk';

async function replaceChannelForeignKey(
  queryInterface,
  Sequelize,
  { allowNull, onDelete }
) {
  const references = await queryInterface.getForeignKeyReferencesForTable(
    'external_requests'
  );
  const constraintNames = new Set(
    references
      .filter((reference) =>
        (reference.columnName || reference.column_name) === 'channel_id'
      )
      .map((reference) => reference.constraintName || reference.constraint_name)
      .filter(Boolean)
  );

  for (const constraintName of constraintNames) {
    await queryInterface.removeConstraint('external_requests', constraintName);
  }

  // MariaDB attempts to add a changed reference before making the column
  // nullable when changeColumn receives both operations. Perform the column
  // and constraint changes explicitly so ON DELETE SET NULL is valid.
  await queryInterface.changeColumn('external_requests', 'channel_id', {
    type: Sequelize.INTEGER,
    allowNull,
  });
  await queryInterface.addConstraint('external_requests', {
    fields: ['channel_id'],
    type: 'foreign key',
    name: CHANNEL_FOREIGN_KEY,
    references: { table: 'channels', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete,
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'external_requests', 'channel_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await addColumnIfMissing(
      queryInterface,
      'external_requests',
      'grant_to_requesting_key',
      {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      }
    );
    await replaceChannelForeignKey(queryInterface, Sequelize, {
      allowNull: true,
      onDelete: 'SET NULL',
    });
    await queryInterface.changeColumn('external_requests', 'youtube_id', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'external_requests',
      ['request_type', 'status', 'created_at', 'id'],
      { name: 'external_requests_management_idx' }
    );
  },

  async down(queryInterface, Sequelize) {
    // Channel requests cannot be represented by the original non-null video
    // columns. Remove them before restoring the narrower schema.
    await queryInterface.bulkDelete('external_requests', {
      request_type: { [Sequelize.Op.in]: ['channel', 'delete_video'] },
    });
    await removeIndexIfExists(
      queryInterface,
      'external_requests',
      'external_requests_management_idx'
    );
    await replaceChannelForeignKey(queryInterface, Sequelize, {
      allowNull: false,
      onDelete: 'CASCADE',
    });
    await queryInterface.changeColumn('external_requests', 'youtube_id', {
      type: Sequelize.STRING(32),
      allowNull: false,
    });
    await removeColumnIfExists(queryInterface, 'external_requests', 'channel_url');
    await removeColumnIfExists(
      queryInterface,
      'external_requests',
      'grant_to_requesting_key'
    );
  },
};
