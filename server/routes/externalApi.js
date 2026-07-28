const express = require('express');
const { sendExternalError } = require('../modules/externalApiResponse');
const { scopesForExternalKey } = require('../modules/externalPermissions');

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
  /**
   * @swagger
   * /external-api/v1/capabilities:
   *   get:
   *     summary: Read the calling key's effective external capabilities
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     responses:
   *       200: { description: Effective role, scopes, policy, and feature flags }
   *       401:
   *         description: Missing, invalid, legacy, revoked, or corrupt-policy key
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ExternalError' }
   */
  router.get('/capabilities', (req, res) => {
    const key = req.externalApiKey;
    const scopes = scopesForExternalKey(key) || [];
    res.json({
      apiVersion: '1',
      serverVersion,
      role: key.role,
      scopes,
      policy: {
        allowVideoRequests: key.allowVideoRequests,
        allowChannelRequests: key.allowChannelRequests,
        allowDeleteVideoRequests: key.allowDeleteVideoRequests,
        autoApproveVideoRequests: key.autoApproveVideoRequests,
        autoApproveChannelRequests: key.autoApproveChannelRequests,
        autoApproveDeleteRequests: key.autoApproveDeleteRequests,
        maxRatingLevel: key.maxRatingLevel,
        allowUnrated: key.allowUnrated,
        allowedMediaTypes: key.allowedMediaTypes,
      },
      features: {
        catalog: true, requests: true, channelRequests: true, deleteRequests: true,
        recommendations: true, authenticatedAssets: true,
      },
    });
  });

  const sendCatalogError = (req, res, error) => {
    if (error.name === 'CatalogError' && error.status >= 400 && error.status < 500) {
      return sendExternalError(res, error.status, error.message, {
        code: error.code,
        requestId: req.id,
      });
    }
    req.log?.error({ err: error }, 'External catalog request failed');
    return sendExternalError(res, 500, 'External catalog request failed');
  };

  const sendRequestError = (req, res, error) => {
    if (error.name === 'RequestError' && error.status >= 400 && error.status < 500) {
      return sendExternalError(res, error.status, error.message, {
        code: error.code,
        requestId: req.id,
      });
    }
    req.log?.error({ err: error }, 'External request operation failed');
    return sendExternalError(res, 500, 'External request operation failed');
  };

  /**
   * @swagger
   * /external-api/v1/channels:
   *   get:
   *     summary: Browse cached channels granted to the calling key
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
   *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
   *       - { in: query, name: search, schema: { type: string, maxLength: 200 } }
   *       - { in: query, name: subfolder, schema: { type: string, maxLength: 255 } }
   *       - { in: query, name: sortBy, schema: { type: string, enum: [title, videoCount, downloadedCount, id] } }
   *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
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

  /**
   * @swagger
   * /external-api/v1/channels/{id}/videos:
   *   get:
   *     summary: Browse eligible cached videos in one granted channel
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: integer } }
   *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
   *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
   *       - { in: query, name: search, schema: { type: string, maxLength: 200 } }
   *       - { in: query, name: tabType, schema: { type: string, enum: [videos, shorts, streams] } }
   *       - { in: query, name: status, schema: { type: string, enum: [downloaded, available, requested] } }
   *       - { in: query, name: minDuration, schema: { type: integer, minimum: 0 } }
   *       - { in: query, name: maxDuration, schema: { type: integer, minimum: 0 } }
   *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
   *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
   *     responses:
   *       200: { description: Paginated policy-filtered cached videos }
   *       404:
   *         description: Missing, disabled, terminated, or ungranted channel
   */
  router.get('/channels/:id/videos', async (req, res) => {
    try {
      return res.json(await catalogService.listChannelVideos(req.externalApiKey, req.params.id, req.query));
    } catch (error) {
      return sendCatalogError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/videos:
   *   get:
   *     summary: Read the bounded cross-channel recommendation candidate feed
   *     description: At most three pages of 100 policy-filtered cached candidates are available.
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - { in: query, name: page, schema: { type: integer, minimum: 1, maximum: 3 } }
   *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
   *       - { in: query, name: status, schema: { type: string, enum: [downloaded, available, requested] } }
   *     responses:
   *       200: { description: Paginated candidates; no Plex-derived signal enters Youtarr }
   */
  router.get('/videos', async (req, res) => {
    try {
      return res.json(await catalogService.listVideos(req.externalApiKey, req.query));
    } catch (error) {
      return sendCatalogError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/assets/channels/{id}/thumbnail:
   *   get:
   *     summary: Read eligible private channel artwork
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: integer } }
   *     responses:
   *       200: { description: Private JPEG artwork }
   *       404: { description: Missing, unsafe, disabled, terminated, or ungranted asset }
   */
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
   * /external-api/v1/assets/videos/{youtubeId}/thumbnail:
   *   get:
   *     summary: Read eligible private video artwork
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     parameters:
   *       - { in: path, name: youtubeId, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Private JPEG artwork }
   *       404: { description: Missing, unsafe, disabled, terminated, ungranted, or ineligible asset }
   */
  router.get('/assets/videos/:youtubeId/thumbnail', async (req, res) => {
    try {
      const absolutePath = await catalogService.getVideoThumbnail(
        req.externalApiKey,
        req.params.youtubeId
      );
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
   * /external-api/v1/requests/channels:
   *   post:
   *     summary: Request canonical YouTube channel provisioning
   *     tags: [External API]
   *     security: [{ ExternalApiKeyAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [channelUrl]
   *             properties:
   *               channelUrl: { type: string, format: uri, maxLength: 500 }
   *               idempotencyKey: { type: string, maxLength: 200 }
   *     responses:
   *       202: { description: Approval-backed channel request created }
   *       200: { description: Existing idempotent request returned }
   */
  router.post('/requests/channels', externalApiWriteLimiter, async (req, res) => {
    try {
      const result = await requests().createChannelRequest(req.externalApiKey, req.body);
      return res.status(result.outcome === 'created' ? 202 : 200).json(result);
    } catch (error) {
      return sendRequestError(req, res, error);
    }
  });

  /**
   * @swagger
   * /external-api/v1/requests/delete-videos:
   *   post:
   *     summary: Request deletion of a downloaded video asset
   *     description: This never removes or disables the channel subscription.
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
   *               youtubeId: { type: string, minLength: 11, maxLength: 11 }
   *               channelId: { type: integer, minimum: 1 }
   *               idempotencyKey: { type: string, maxLength: 200 }
   *     responses:
   *       202: { description: Approval-backed deletion request created }
   *       200: { description: Duplicate or already-deleted target }
   */
  router.post('/requests/delete-videos', externalApiWriteLimiter, async (req, res) => {
    try {
      const result = await requests().createDeleteVideoRequest(req.externalApiKey, req.body);
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

module.exports = { createExternalApiRoutes };
