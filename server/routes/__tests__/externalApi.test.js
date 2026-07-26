const express = require('express');
const request = require('supertest');
const { createExternalApiAuth } = require('../../middleware/externalApiAuth');
const { createExternalApiRoutes } = require('../externalApi');

function makeApp({ enabled = true, key } = {}) {
  const app = express();
  const validateApiKey = jest.fn().mockResolvedValue(key || null);
  if (enabled) {
    app.use('/external-api/v1', createExternalApiRoutes({
      externalApiAuth: createExternalApiAuth({ validateApiKey }),
      externalApiLimiter: (_req, _res, next) => next(),
      serverVersion: '1.77.0',
    }));
  } else {
    app.use('/external-api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  }
  return { app, validateApiKey };
}

const externalKey = (overrides = {}) => ({
  id: 4, name: 'External Client', role: 'request', revoked_at: null,
  auto_approve_video_requests: true, auto_approve_channel_requests: false,
  auto_approve_delete_requests: false, max_rating_level: 3, allow_unrated: false,
  allowed_media_types: ['video'], ...overrides,
});

describe('external API capabilities', () => {
  test('returns 404 when feature flag is disabled', async () => {
    const { app } = makeApp({ enabled: false });
    await request(app).get('/external-api/v1/capabilities').expect(404);
  });

  test('requires x-api-key even when application auth is disabled', async () => {
    const old = process.env.AUTH_ENABLED;
    process.env.AUTH_ENABLED = 'false';
    const { app } = makeApp({ key: externalKey() });
    await request(app).get('/external-api/v1/capabilities').expect(401, { error: 'x-api-key is required' });
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
        catalog: false, requests: false, channelRequests: false, deleteRequests: false,
        recommendations: false, authenticatedAssets: false,
      },
    });
  });

  test('normalizes supported media types and rejects corrupt media policies', async () => {
    const normalized = makeApp({ key: externalKey({ allowed_media_types: ['video', 'unknown', 'video'] }) });
    await request(normalized.app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key')
      .expect(200).expect((response) => expect(response.body.policy.allowedMediaTypes).toEqual(['video']));

    const corrupt = makeApp({ key: externalKey({ allowed_media_types: ['unknown'] }) });
    await request(corrupt.app).get('/external-api/v1/capabilities').set('x-api-key', 'test-key').expect(401);
  });
});
