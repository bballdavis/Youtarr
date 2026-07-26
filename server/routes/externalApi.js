const express = require('express');

const ROLE_SCOPES = {
  view: ['catalog:read', 'requests:read'],
  request: ['catalog:read', 'requests:read', 'video:request', 'channel:request'],
  delete: ['catalog:read', 'requests:read', 'video:request', 'channel:request', 'video:delete'],
  admin: ['catalog:read', 'requests:read', 'video:request', 'channel:request', 'video:delete', 'requests:review'],
};

function createExternalApiRoutes({ externalApiAuth, externalApiLimiter, serverVersion }) {
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
        catalog: false, requests: false, channelRequests: false, deleteRequests: false,
        recommendations: false, authenticatedAssets: false,
      },
    });
  });
  return router;
}

module.exports = { createExternalApiRoutes, ROLE_SCOPES };
