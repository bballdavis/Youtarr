'use strict';

const {
  addIndexIfMissing,
  removeIndexIfExists,
  tableExists,
} = require('./helpers');

/**
 * Canonical YouTube channel IDs are global identities. Consolidate historical
 * duplicates, preserve external grants/request references, then make the
 * database the cross-process serialization point for channel provisioning.
 */
module.exports = {
  async up(queryInterface) {
    if (!(await tableExists(queryInterface, 'channels'))) return;

    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(`
        CREATE TEMPORARY TABLE youtarr_channel_survivors AS
        SELECT channel_id, MIN(id) AS survivor_id
        FROM channels
        WHERE channel_id IS NOT NULL AND channel_id <> ''
        GROUP BY channel_id
      `, { transaction });

      if (await tableExists(queryInterface, 'external_requests')) {
        await queryInterface.sequelize.query(`
          UPDATE external_requests request
          INNER JOIN channels duplicate ON request.channel_id = duplicate.id
          INNER JOIN youtarr_channel_survivors survivor
            ON duplicate.channel_id = survivor.channel_id
          SET request.channel_id = survivor.survivor_id
          WHERE request.channel_id <> survivor.survivor_id
        `, { transaction });
      }

      if (await tableExists(queryInterface, 'api_key_channel_grants')) {
        await queryInterface.sequelize.query(`
          DELETE duplicate_grant
          FROM api_key_channel_grants duplicate_grant
          INNER JOIN channels duplicate
            ON duplicate_grant.channel_id = duplicate.id
          INNER JOIN youtarr_channel_survivors survivor
            ON duplicate.channel_id = survivor.channel_id
          INNER JOIN api_key_channel_grants survivor_grant
            ON survivor_grant.api_key_id = duplicate_grant.api_key_id
            AND survivor_grant.channel_id = survivor.survivor_id
          WHERE duplicate_grant.channel_id <> survivor.survivor_id
        `, { transaction });
        await queryInterface.sequelize.query(`
          UPDATE api_key_channel_grants grant_row
          INNER JOIN channels duplicate ON grant_row.channel_id = duplicate.id
          INNER JOIN youtarr_channel_survivors survivor
            ON duplicate.channel_id = survivor.channel_id
          SET grant_row.channel_id = survivor.survivor_id
          WHERE grant_row.channel_id <> survivor.survivor_id
        `, { transaction });
      }

      await queryInterface.sequelize.query(`
        DELETE duplicate
        FROM channels duplicate
        INNER JOIN youtarr_channel_survivors survivor
          ON duplicate.channel_id = survivor.channel_id
        WHERE duplicate.id <> survivor.survivor_id
      `, { transaction });
      await queryInterface.sequelize.query(
        'DROP TEMPORARY TABLE youtarr_channel_survivors',
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await removeIndexIfExists(
      queryInterface,
      'channels',
      'channels_external_channel_id_idx'
    );
    await addIndexIfMissing(queryInterface, 'channels', ['channel_id'], {
      unique: true,
      name: 'channels_channel_id_uq',
    });
  },

  async down(queryInterface) {
    await removeIndexIfExists(queryInterface, 'channels', 'channels_channel_id_uq');
    await addIndexIfMissing(queryInterface, 'channels', ['channel_id'], {
      name: 'channels_external_channel_id_idx',
    });
  },
};
