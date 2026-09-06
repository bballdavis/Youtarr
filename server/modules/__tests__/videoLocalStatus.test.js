/* eslint-env jest */
jest.mock('../../models', () => ({ Video: { findAll: jest.fn() } }));
const { Video } = require('../../models');
const { applyLocalVideoStatus } = require('../videoLocalStatus');

beforeEach(() => jest.clearAllMocks());

it('does not query for an empty list', async () => {
  await applyLocalVideoStatus([]);
  expect(Video.findAll).not.toHaveBeenCalled();
});

it('merges downloaded and removed records while leaving unknown videos alone', async () => {
  Video.findAll.mockResolvedValue([
    { id: 1, youtubeId: 'aaaaaaaaaaa', removed: false, filePath: '/video.mp4', fileSize: 123,
      audioFilePath: '/audio.mp3', audioFileSize: 45, last_downloaded_at: '2026-09-01T00:00:00Z',
      protected: true, normalized_rating: 'PG', rating_source: 'manual' },
    { id: 2, youtubeId: 'bbbbbbbbbbb', removed: true, last_downloaded_at: null, protected: false },
  ]);
  const results = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(youtubeId => ({ youtubeId, status: 'never_downloaded' }));
  await applyLocalVideoStatus(results);
  expect(results[0]).toMatchObject({ status: 'downloaded', databaseId: 1, filePath: '/video.mp4',
    fileSize: 123, audioFilePath: '/audio.mp3', audioFileSize: 45, addedAt: '2026-09-01T00:00:00.000Z',
    isProtected: true, normalizedRating: 'PG', ratingSource: 'manual' });
  expect(results[1]).toMatchObject({ status: 'missing', databaseId: 2, addedAt: null, isProtected: false });
  expect(results[2]).toEqual({ youtubeId: 'ccccccccccc', status: 'never_downloaded' });
});
