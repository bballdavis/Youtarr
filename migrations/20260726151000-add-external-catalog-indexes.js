'use strict';

const {
  addIndexIfMissing,
  removeIndexIfExists,
} = require('./helpers');

const INDEXES = [
  {
    table: 'channelvideos',
    fields: ['channel_id', 'media_type', 'youtube_removed', 'ignored'],
    name: 'channelvideos_external_channel_idx',
  },
  {
    table: 'channelvideos',
    fields: ['youtube_id', 'channel_id'],
    name: 'channelvideos_external_youtube_idx',
  },
  {
    table: 'channelvideos',
    fields: ['youtube_removed', 'ignored', 'media_type', 'publishedAt'],
    name: 'channelvideos_external_candidates_idx',
  },
  {
    table: 'channels',
    fields: ['channel_id'],
    name: 'channels_external_channel_id_idx',
  },
  {
    table: 'channels',
    fields: ['enabled', 'terminated_at', 'id'],
    name: 'channels_external_visibility_idx',
  },
  {
    table: 'channels',
    fields: [
      'enabled',
      'terminated_at',
      { name: 'sub_folder', length: 191 },
    ],
    name: 'channels_external_subfolder_idx',
  },
];

module.exports = {
  async up(queryInterface) {
    for (const index of INDEXES) {
      await addIndexIfMissing(
        queryInterface,
        index.table,
        index.fields,
        { name: index.name }
      );
    }
  },

  async down(queryInterface) {
    for (const index of [...INDEXES].reverse()) {
      await removeIndexIfExists(queryInterface, index.table, index.name);
    }
  },
};

module.exports.INDEXES = INDEXES;
