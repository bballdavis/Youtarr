'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./helpers');

/**
 * Makes request capabilities independently configurable while retaining the
 * cumulative role as a backward-compatible summary for older clients.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('ApiKeys');
    const permissions = [
      {
        column: 'allow_video_requests',
        enabledRoles: "'request', 'delete', 'admin'",
      },
      {
        column: 'allow_channel_requests',
        enabledRoles: "'request', 'delete', 'admin'",
      },
      {
        column: 'allow_delete_video_requests',
        enabledRoles: "'delete', 'admin'",
      },
    ];

    for (const permission of permissions) {
      if (columns[permission.column]) continue;

      await addColumnIfMissing(queryInterface, 'ApiKeys', permission.column, {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
      await queryInterface.sequelize.query(`
        UPDATE ApiKeys
        SET ${permission.column} = CASE
          WHEN role IN (${permission.enabledRoles}) THEN true ELSE false END
      `);
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable('ApiKeys');
    const rollbackChecks = [
      columns.allow_video_requests
        ? "allow_video_requests <> CASE WHEN role IN ('request', 'delete', 'admin') THEN true ELSE false END"
        : null,
      columns.allow_channel_requests
        ? "allow_channel_requests <> CASE WHEN role IN ('request', 'delete', 'admin') THEN true ELSE false END"
        : null,
      columns.allow_delete_video_requests
        ? "allow_delete_video_requests <> CASE WHEN role IN ('delete', 'admin') THEN true ELSE false END"
        : null,
    ].filter(Boolean);

    // A cumulative legacy role cannot represent every granular combination.
    // Revoke those keys before removing the columns so rollback can never
    // silently broaden their authority.
    if (rollbackChecks.length > 0 && columns.is_active && columns.revoked_at) {
      await queryInterface.sequelize.query(`
        UPDATE ApiKeys
        SET is_active = false,
            revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE role <> 'legacy_download'
          AND (${rollbackChecks.join('\n          OR ')})
      `);
    }

    for (const column of [
      'allow_delete_video_requests',
      'allow_channel_requests',
      'allow_video_requests',
    ]) {
      await removeColumnIfExists(queryInterface, 'ApiKeys', column);
    }
  },
};
