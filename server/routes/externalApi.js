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
  serverVersion,
  catalogService = require('../modules/externalCatalogService'),
}) {
  const router = express.Router();
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
        catalog: true, requests: false, channelRequests: false, deleteRequests: false,
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
  return router;
}

module.exports = { createExternalApiRoutes, ROLE_SCOPES };
