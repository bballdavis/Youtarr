const express = require('express');

const ROLE_SCOPES = {
  view: ['catalog:read', 'requests:read'],
  request: ['catalog:read', 'requests:read', 'video:request', 'channel:request'],
  delete: ['catalog:read', 'requests:read', 'video:request', 'channel:request', 'video:delete'],
  admin: ['catalog:read', 'requests:read', 'video:request', 'channel:request', 'video:delete', 'requests:review'],
};

function createExternalApiRoutes({
  externalApiAuth,
  externalApiLimiter,
  externalApiWriteLimiter = (_req, _res, next) => next(),
  serverVersion,
  catalogService = require('../modules/externalCatalogService'),
  requestService = null,
}) {
  const router = express.Router();
  const requests = () => requestService ||
    require('../modules/externalRequestService').createExternalRequestService();
  router.use(externalApiAuth, externalApiLimiter);
  router.get('/capabilities', (req, res) => {
    const key = req.externalApiKey;
    res.json({
      apiVersion: '1',
      serverVersion,
      role: key.role,
      scopes: ROLE_SCOPES[key.role] || [],
      policy: {
        autoApproveVideoRequests: key.autoApproveVideoRequests,
        autoApproveChannelRequests: key.autoApproveChannelRequests,
        autoApproveDeleteRequests: key.autoApproveDeleteRequests,
        maxRatingLevel: key.maxRatingLevel,
        allowUnrated: key.allowUnrated,
        allowedMediaTypes: key.allowedMediaTypes,
      },
      features: {
        catalog: true, requests: true, channelRequests: false, deleteRequests: false,
        recommendations: false, authenticatedAssets: true,
      },
    });
  });

  const sendCatalogError = (req, res, error) => {
    if (error.name === 'CatalogError' && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    req.log?.error({ err: error }, 'External catalog request failed');
    return res.status(500).json({ error: 'External catalog request failed' });
  };

  const sendRequestError = (req, res, error) => {
    if (error.name === 'RequestError' && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    req.log?.error({ err: error }, 'External request operation failed');
    return res.status(500).json({ error: 'External request operation failed' });
  };

  /**
   * @swagger
   * /external-api/v1/channels:
   *   get:
   *     summary: Browse cached channels granted to the calling key
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     responses:
   *       200: { description: Paginated cached channel catalog }
   *       401: { description: Missing or invalid external API key }
   */
  router.get('/channels', async (req, res) => {
    try {
      return res.json(await catalogService.listChannels(req.externalApiKey, req.query));
    } catch (error) {
      return sendCatalogError(req, res, error);
    }
  });

  router.get('/channels/:id/videos', async (req, res) => {
    try {
      return res.json(await catalogService.listChannelVideos(req.externalApiKey, req.params.id, req.query));
    } catch (error) {
      return sendCatalogError(req, res, error);
    }
  });

  router.get('/assets/channels/:id/thumbnail', async (req, res) => {
    try {
      const absolutePath = await catalogService.getChannelThumbnail(req.externalApiKey, req.params.id);
      res.set({
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.sendFile(absolutePath);
    } catch (error) {
      return sendCatalogError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/requests/videos:
   *   post:
   *     summary: Request a cached video from a granted channel
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [youtubeId, channelId]
   *             properties:
   *               youtubeId: { type: string }
   *               channelId: { type: integer }
   *               idempotencyKey: { type: string, maxLength: 200 }
   *     responses:
   *       202: { description: Request persisted }
   *       403: { description: Scope or content policy denied the request }
   *       404: { description: Granted cached video not found }
   *       409: { description: Idempotency key target conflict }
   */
  router.post('/requests/videos', externalApiWriteLimiter, async (req, res) => {
    try {
      const result = await requests().createVideoRequest(req.externalApiKey, req.body);
      return res.status(result.outcome === 'created' ? 202 : 200).json(result);
    } catch (error) {
      return sendRequestError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/requests:
   *   get:
   *     summary: List requests created by the calling key
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: pageSize
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, approved, processing, completed, rejected, failed, cancelled]
   *     responses:
   *       200: { description: Paginated request status list }
   */
  router.get('/requests', async (req, res) => {
    try {
      return res.json(await requests().listRequests(req.externalApiKey, req.query));
    } catch (error) {
      return sendRequestError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/requests/{id}:
   *   get:
   *     summary: Read one request created by the calling key
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Request status }
   *       404: { description: Request not found }
   */
  router.get('/requests/:id', async (req, res) => {
    try {
      return res.json(await requests().getRequest(req.externalApiKey, req.params.id));
    } catch (error) {
      return sendRequestError(req, res, error);
    }
  });
  return router;
}

module.exports = { createExternalApiRoutes, ROLE_SCOPES };
