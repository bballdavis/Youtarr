'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./helpers');

/**
 * Adds policy fields without changing existing API-key behavior. Existing
 * keys are deliberately classified as legacy_download so they cannot gain
 * access to the versioned external API by migration alone.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'role', {
      type: Sequelize.STRING(32), allowNull: false, defaultValue: 'legacy_download',
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'auto_approve_video_requests', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'auto_approve_channel_requests', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'auto_approve_delete_requests', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'max_rating_level', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 4,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'allow_unrated', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    // MariaDB JSON defaults vary by supported version. Backfill explicitly;
    // the model supplies the same default for all future inserts.
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'allowed_media_types', {
      type: Sequelize.JSON, allowNull: true, defaultValue: null,
    });
    await queryInterface.sequelize.query(
      "UPDATE ApiKeys SET role = 'legacy_download' WHERE role IS NULL OR role = ''"
    );
    await queryInterface.sequelize.query(
      "UPDATE ApiKeys SET allowed_media_types = JSON_ARRAY('video') WHERE allowed_media_types IS NULL"
    );
    await queryInterface.changeColumn('ApiKeys', 'allowed_media_types', {
      type: Sequelize.JSON, allowNull: false,
    });
    await addColumnIfMissing(queryInterface, 'ApiKeys', 'revoked_at', {
      type: Sequelize.DATE, allowNull: true, defaultValue: null,
    });
  },

  async down(queryInterface) {
    // An older server treats every active key as legacy download-capable.
    // Disable external-role keys before removing the distinguishing columns so
    // rollback cannot silently broaden their access.
    await queryInterface.sequelize.query(`
      UPDATE ApiKeys
      SET is_active = false,
          revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE role IS NOT NULL AND role <> 'legacy_download'
    `);
    for (const column of ['revoked_at', 'allowed_media_types', 'allow_unrated', 'max_rating_level',
      'auto_approve_delete_requests', 'auto_approve_channel_requests', 'auto_approve_video_requests', 'role']) {
      await removeColumnIfExists(queryInterface, 'ApiKeys', column);
    }
  },
};
