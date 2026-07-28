const EXTERNAL_ROLES = ['view', 'request', 'delete', 'admin'];
const ALLOWED_MEDIA_TYPES = ['video', 'short', 'livestream'];
const { sendExternalError } = require('../modules/externalApiResponse');

function normalizeAllowedMediaTypes(value) {
  // Null/missing is the only tolerated legacy shape during migration rollout.
  if (value === null || value === undefined) return ['video'];
  if (!Array.isArray(value)) return null;
  if (value.some((type) => !ALLOWED_MEDIA_TYPES.includes(type))) return null;
  const types = [...new Set(value)];
  return types.length > 0 ? types : null;
}

function createExternalApiAuth({ validateApiKey }) {
  return async function externalApiAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') {
      return sendExternalError(res, 401, 'x-api-key is required', {
        code: 'missing_api_key',
        requestId: req.id,
      });
    }

    try {
      const apiKey = await validateApiKey(key);
      if (!apiKey || apiKey.revoked_at || !EXTERNAL_ROLES.includes(apiKey.role)) {
        return sendExternalError(res, 401, 'Invalid external API key', {
          code: 'invalid_api_key',
          requestId: req.id,
        });
      }
      const allowedMediaTypes = normalizeAllowedMediaTypes(apiKey.allowed_media_types);
      if (!allowedMediaTypes) {
        return sendExternalError(res, 401, 'Invalid external API key policy', {
          code: 'invalid_key_policy',
          requestId: req.id,
        });
      }
      req.externalApiKey = {
        id: apiKey.id,
        name: apiKey.name,
        role: apiKey.role,
        autoApproveVideoRequests: apiKey.auto_approve_video_requests,
        autoApproveChannelRequests: apiKey.auto_approve_channel_requests,
        autoApproveDeleteRequests: apiKey.auto_approve_delete_requests,
        maxRatingLevel: apiKey.max_rating_level,
        allowUnrated: apiKey.allow_unrated,
        allowedMediaTypes,
      };
      return next();
    } catch (error) {
      req.log?.error({ err: error }, 'External API key verification failed');
      return sendExternalError(res, 500, 'External API authentication error', {
        requestId: req.id,
      });
    }
  };
}

module.exports = { createExternalApiAuth, EXTERNAL_ROLES, normalizeAllowedMediaTypes };
