const express = require('express');
const request = require('supertest');
const { createExternalApiAuth } = require('../../middleware/externalApiAuth');
const { createExternalApiRoutes } = require('../externalApi');

function makeApp({ enabled = true, key, catalogService, requestService, writeLimiter } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.id = 'request-123';
    next();
  });
  app.use(express.json());
  const validateApiKey = jest.fn().mockResolvedValue(key || null);
  if (enabled) {
    app.use('/external-api/v1', createExternalApiRoutes({
      externalApiAuth: createExternalApiAuth({ validateApiKey }),
      externalApiLimiter: (_req, _res, next) => next(),
      externalApiWriteLimiter: writeLimiter || ((_req, _res, next) => next()),
      serverVersion: '1.77.0',
      catalogService,
      requestService,
    }));
  } else {
    app.use('/external-api', (_req, res) => res.status(404).json({
      error: { code: 'not_found', message: 'External API route not found' },
    }));
  }
  return { app, validateApiKey };
}

const externalKey = (overrides = {}) => ({
  id: 4, name: 'Plinx', role: 'request', revoked_at: null,
  auto_approve_video_requests: true, auto_approve_channel_requests: false,
  auto_approve_delete_requests: false, max_rating_level: 3, allow_unrated: false,
  allowed_media_types: ['video'], ...overrides,
});

describe('external API capabilities', () => {
  test('returns 404 when feature flag is disabled', async () => {
    const { app } = makeApp({ enabled: false });
    await request(app).get('/external-api/v1/capabilities').expect(404, {
      error: { code: 'not_found', message: 'External API route not found' },
    });
  });

  test('requires x-api-key even when application auth is disabled', async () => {
    const old = process.env.AUTH_ENABLED;
    process.env.AUTH_ENABLED = 'false';
    const { app } = makeApp({ key: externalKey() });
    await request(app).get('/external-api/v1/capabilities').expect(401, {
      error: {
        code: 'missing_api_key',
        message: 'x-api-key is required',
        requestId: 'request-123',
      },
    });
    process.env.AUTH_ENABLED = old;
  });

  test.each([
    ['invalid', null],
    ['legacy', externalKey({ role: 'legacy_download' })],
    ['revoked', externalKey({ revoked_at: new Date() })],
  ])('rejects %s external keys', async (_name, key) => {
    const { app } = makeApp({ key });
    await request(app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key').expect(401);
  });

  test('returns role scopes and sanitized policy', async () => {
    const { app } = makeApp({ key: externalKey() });
    const response = await request(app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key').expect(200);
    expect(response.body).toEqual({
      apiVersion: '1', serverVersion: '1.77.0', role: 'request',
      scopes: ['catalog:read', 'requests:read', 'video:request', 'channel:request'],
      policy: {
        autoApproveVideoRequests: true, autoApproveChannelRequests: false,
        autoApproveDeleteRequests: false, maxRatingLevel: 3, allowUnrated: false,
        allowedMediaTypes: ['video'],
      },
      features: {
        catalog: true, requests: true, channelRequests: true, deleteRequests: true,
        recommendations: true, authenticatedAssets: true,
      },
    });
  });

  test('persists video requests behind the lower write limiter', async () => {
    const requestService = {
      createVideoRequest: jest.fn().mockResolvedValue({
        outcome: 'created',
        request: {
          id: '9b89e5bc-8c90-4e72-b245-270fed2eacc2',
          type: 'video',
          status: 'pending',
          target: { youtubeId: 'abcdefghijk', channelId: 8 },
          createdAt: '2026-07-26T12:00:00.000Z',
          updatedAt: '2026-07-26T12:00:00.000Z',
        },
      }),
      listRequests: jest.fn(),
      getRequest: jest.fn(),
    };
    const writeLimiter = jest.fn((_req, _res, next) => next());
    const { app } = makeApp({ key: externalKey(), requestService, writeLimiter });
    await request(app).post('/external-api/v1/requests/videos')
      .set('x-api-key', 'test-key')
      .send({ youtubeId: 'abcdefghijk', channelId: 8 })
      .expect(202)
      .expect((response) => expect(response.body.outcome).toBe('created'));
    expect(writeLimiter).toHaveBeenCalled();
    expect(requestService.createVideoRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, role: 'request' }),
      { youtubeId: 'abcdefghijk', channelId: 8 }
    );
  });

  test('routes candidate, channel, and delete operations through constrained services', async () => {
    const catalogService = {
      listVideos: jest.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        dataSource: 'cache',
        isFullyIndexed: true,
      }),
    };
    const requestService = {
      createChannelRequest: jest.fn().mockResolvedValue({
        outcome: 'created',
        request: { type: 'channel', status: 'pending' },
      }),
      createDeleteVideoRequest: jest.fn().mockResolvedValue({
        outcome: 'already_deleted',
        request: null,
      }),
    };
    const writeLimiter = jest.fn((_req, _res, next) => next());
    const { app } = makeApp({
      key: externalKey({ role: 'delete' }),
      catalogService,
      requestService,
      writeLimiter,
    });

    await request(app).get('/external-api/v1/videos?page=1&pageSize=100')
      .set('x-api-key', 'test-key').expect(200);
    await request(app).post('/external-api/v1/requests/channels')
      .set('x-api-key', 'test-key')
      .send({ channelUrl: 'https://www.youtube.com/@safe' })
      .expect(202);
    await request(app).post('/external-api/v1/requests/delete-videos')
      .set('x-api-key', 'test-key')
      .send({ youtubeId: 'abcdefghijk', channelId: 8 })
      .expect(200, { outcome: 'already_deleted', request: null });

    expect(catalogService.listVideos).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, role: 'delete' }),
      expect.objectContaining({ page: '1', pageSize: '100' })
    );
    expect(requestService.createChannelRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4 }),
      { channelUrl: 'https://www.youtube.com/@safe' }
    );
    expect(requestService.createDeleteVideoRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4 }),
      { youtubeId: 'abcdefghijk', channelId: 8 }
    );
    expect(writeLimiter).toHaveBeenCalledTimes(2);
  });

  test('lists and reads only through the authenticated request service', async () => {
    const requestService = {
      createVideoRequest: jest.fn(),
      listRequests: jest.fn().mockResolvedValue({
        data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      }),
      getRequest: jest.fn().mockResolvedValue({
        id: '9b89e5bc-8c90-4e72-b245-270fed2eacc2',
        type: 'video',
        status: 'pending',
        target: { youtubeId: 'abcdefghijk', channelId: 8 },
        createdAt: '2026-07-26T12:00:00.000Z',
        updatedAt: '2026-07-26T12:00:00.000Z',
      }),
    };
    const { app } = makeApp({ key: externalKey(), requestService });
    await request(app).get('/external-api/v1/requests?status=pending')
      .set('x-api-key', 'test-key').expect(200);
    await request(app)
      .get('/external-api/v1/requests/9b89e5bc-8c90-4e72-b245-270fed2eacc2')
      .set('x-api-key', 'test-key').expect(200);
    expect(requestService.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4 }),
      expect.objectContaining({ status: 'pending' })
    );
    expect(requestService.getRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4 }),
      '9b89e5bc-8c90-4e72-b245-270fed2eacc2'
    );
  });

  test('normalizes duplicate media types and fails closed on unknown media policies', async () => {
    const normalized = makeApp({ key: externalKey({ allowed_media_types: ['video', 'video'] }) });
    await request(normalized.app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key')
      .expect(200).expect((response) => expect(response.body.policy.allowedMediaTypes).toEqual(['video']));

    const corrupt = makeApp({ key: externalKey({ allowed_media_types: ['video', 'unknown'] }) });
    await request(corrupt.app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key').expect(401);
  });

  test('protects catalog routes and forwards only authenticated key policy', async () => {
    const catalogService = {
      listChannels: jest.fn().mockResolvedValue({
        data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 }, dataSource: 'cache',
      }),
      listChannelVideos: jest.fn(),
      getChannelThumbnail: jest.fn(),
    };
    const { app } = makeApp({ key: externalKey(), catalogService });
    await request(app).get('/external-api/v1/channels').expect(401);
    await request(app).get('/external-api/v1/channels?page=1').set('x-api-key', 'test-key').expect(200);
    expect(catalogService.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, maxRatingLevel: 3, allowedMediaTypes: ['video'] }),
      expect.objectContaining({ page: '1' })
    );
  });

  test('does not reveal whether an ungranted channel exists', async () => {
    const notFound = Object.assign(new Error('Channel not found'), { name: 'CatalogError', status: 404 });
    const catalogService = {
      listChannels: jest.fn(),
      listChannelVideos: jest.fn().mockRejectedValue(notFound),
      getChannelThumbnail: jest.fn().mockRejectedValue(
        Object.assign(new Error('Thumbnail not found'), { name: 'CatalogError', status: 404 })
      ),
    };
    const { app } = makeApp({ key: externalKey(), catalogService });
    await request(app).get('/external-api/v1/channels/99/videos').set('x-api-key', 'test-key')
      .expect(404, {
        error: {
          code: 'not_found',
          message: 'Channel not found',
          requestId: 'request-123',
        },
      });
    await request(app).get('/external-api/v1/assets/channels/99/thumbnail').set('x-api-key', 'test-key')
      .expect(404, {
        error: {
          code: 'not_found',
          message: 'Thumbnail not found',
          requestId: 'request-123',
        },
      });
  });

  test('serves granted channel artwork with private cache and nosniff headers', async () => {
    const catalogService = {
      listChannels: jest.fn(),
      listChannelVideos: jest.fn(),
      getChannelThumbnail: jest.fn().mockResolvedValue(__filename),
    };
    const { app } = makeApp({ key: externalKey(), catalogService });
    const response = await request(app)
      .get('/external-api/v1/assets/channels/8/thumbnail')
      .set('x-api-key', 'test-key')
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, max-age=3600');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
  });
});
