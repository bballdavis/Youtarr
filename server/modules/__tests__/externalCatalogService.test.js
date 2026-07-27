jest.mock('../../db', () => ({
  sequelize: { query: jest.fn() },
}));
jest.mock('../configModule', () => ({
  getImagePath: jest.fn(() => '/safe/images'),
}));

const { sequelize } = require('../../db');
const catalog = require('../externalCatalogService');

const key = (overrides = {}) => ({
  id: 4,
  maxRatingLevel: 2,
  allowUnrated: false,
  allowedMediaTypes: ['video'],
  ...overrides,
});

describe('external cached catalog', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists only granted enabled channels with SQL paging and policy-filtered counts', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: 8, channel_id: 'UCsafe', title: 'Safe Channel', description: 'Description',
        sub_folder: 'Kids', lastFetchedByTab: '{"video":"2026-07-20T00:00:00.000Z"}',
        videoCount: '12', downloadedCount: '3',
      }]);
    const result = await catalog.listChannels(key(), {
      page: '2', pageSize: '10', search: 'safe', sortBy: 'videoCount', sortOrder: 'desc',
    });

    expect(result.data[0]).toEqual(expect.objectContaining({
      id: 8,
      channelId: 'UCsafe',
      thumbnailUrl: '/external-api/v1/assets/channels/8/thumbnail',
      videoCount: 12,
      downloadedCount: 3,
    }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
    const listSql = sequelize.query.mock.calls[1][0];
    const options = sequelize.query.mock.calls[1][1];
    expect(listSql).toContain('INNER JOIN api_key_channel_grants');
    expect(listSql).toContain('g.api_key_id = :keyId');
    expect(listSql).toContain('LIMIT :pageSize OFFSET :offset');
    expect(listSql).toContain('COALESCE(v.normalized_rating, c.default_rating)');
    expect(options.replacements).toEqual(expect.objectContaining({ keyId: 4, pageSize: 10, offset: 10 }));
    expect(options.replacements.allowedRatings).toContain('TV-Y7');
    expect(options.replacements.recognizedRatings).toContain('TV-Y7');
  });

  test('validates paging and sorting instead of interpolating user input', async () => {
    await expect(catalog.listChannels(key(), { pageSize: '101' })).rejects.toThrow('pageSize');
    await expect(catalog.listChannels(key(), { sortBy: 'title; DROP TABLE channels' })).rejects.toThrow('sortBy');
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('enforces grants, media type, rating, duration, date, and deterministic SQL paging', async () => {
    sequelize.query
      .mockResolvedValueOnce([{
        id: 8, channel_id: 'UCsafe', title: 'Safe Channel',
        lastFetchedByTab: '{"short":"2026-07-20T00:00:00.000Z"}',
      }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        youtube_id: 'abc', title: 'Allowed', thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
        publishedAt: '2026-07-10T00:00:00.000Z', published_at_source: 'exact',
        duration: 90, media_type: 'short', description: null, downloaded_id: null,
        downloaded_removed: null, rating: 'TV-Y', request_status: 'processing',
      }]);
    const result = await catalog.listChannelVideos(
      key({ allowedMediaTypes: ['video', 'short'] }),
      '8',
      {
        tabType: 'shorts', minDuration: '30', maxDuration: '120',
        dateFrom: '2026-07-01', dateTo: '2026-07-31', pageSize: '20',
      }
    );

    expect(result.data[0]).toEqual(expect.objectContaining({
      youtubeId: 'abc', rating: 'TV-Y', channelId: 'UCsafe', mediaType: 'short',
      isDownloaded: false, isRequested: true, requestStatus: 'processing',
    }));
    expect(result.isFullyIndexed).toBe(true);
    const channelSql = sequelize.query.mock.calls[0][0];
    const listSql = sequelize.query.mock.calls[2][0];
    expect(channelSql).toContain('INNER JOIN api_key_channel_grants');
    expect(channelSql).toContain('c.enabled = true');
    expect(listSql).toContain('cv.media_type = :mediaType');
    expect(listSql).toContain('cv.duration >= :minDuration');
    expect(listSql).toContain('cv.duration <= :maxDuration');
    expect(listSql).toContain('cv.publishedAt >= :dateFrom');
    expect(listSql).toContain('ORDER BY cv.publishedAt DESC, cv.youtube_id ASC');
    expect(listSql).toContain('LIMIT :pageSize OFFSET :offset');
    expect(listSql).toContain('FROM external_requests er');
    expect(listSql).toContain('er.api_key_id = :keyId');
  });

  test('fails closed for invalid policy and disallowed media without querying', async () => {
    await expect(catalog.listChannelVideos(key({ maxRatingLevel: 99 }), '8', {}))
      .rejects.toMatchObject({ status: 401 });
    await expect(catalog.listChannelVideos(key(), '8', { tabType: 'shorts' }))
      .rejects.toMatchObject({ status: 403 });
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('keeps TV-Y7 in the rated policy branch when unrated content is allowed', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await catalog.listChannels(key({ allowUnrated: true }), {});

    const options = sequelize.query.mock.calls[1][1];
    expect(options.replacements.allowedRatings).toContain('TV-Y7');
    expect(options.replacements.recognizedRatings).toContain('TV-Y7');
  });

  test('returns the same 404 for missing and ungranted channels', async () => {
    sequelize.query.mockResolvedValueOnce([]);
    await expect(catalog.listChannelVideos(key(), '99', {}))
      .rejects.toMatchObject({ status: 404, message: 'Channel not found' });
  });

  test('rejects unsafe cached thumbnail identifiers without exposing a path', async () => {
    sequelize.query.mockResolvedValueOnce([{ channel_id: '../../secret' }]);
    await expect(catalog.getChannelThumbnail(key(), '8'))
      .rejects.toMatchObject({ status: 404, message: 'Thumbnail not found' });
  });

  test('only exposes HTTPS thumbnail URLs from known YouTube image hosts', () => {
    expect(catalog.publicVideoThumbnail('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toContain('ytimg.com');
    expect(catalog.publicVideoThumbnail('http://i.ytimg.com/vi/abc/hqdefault.jpg')).toBeNull();
    expect(catalog.publicVideoThumbnail('https://example.com/tracker.jpg')).toBeNull();
    expect(catalog.publicVideoThumbnail('/images/local-secret.jpg')).toBeNull();
  });
});
