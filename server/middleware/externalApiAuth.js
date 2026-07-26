const EXTERNAL_ROLES = ['view', 'request', 'delete', 'admin'];
const ALLOWED_MEDIA_TYPES = ['video'];

function normalizeAllowedMediaTypes(value) {
  // Null/missing is the only tolerated legacy shape during migration rollout.
  if (value === null || value === undefined) return ['video'];
  if (!Array.isArray(value)) return null;
  const types = [...new Set(value.filter((type) => ALLOWED_MEDIA_TYPES.includes(type)))];
  return types.length > 0 ? types : null;
}

function createExternalApiAuth({ validateApiKey }) {
  return async function externalApiAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') {
      return res.status(401).json({ error: 'x-api-key is required' });
    }

    try {
      const apiKey = await validateApiKey(key);
      if (!apiKey || apiKey.revoked_at || !EXTERNAL_ROLES.includes(apiKey.role)) {
        return res.status(401).json({ error: 'Invalid external API key' });
      }
      const allowedMediaTypes = normalizeAllowedMediaTypes(apiKey.allowed_media_types);
      if (!allowedMediaTypes) {
        return res.status(401).json({ error: 'Invalid external API key policy' });
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
      return res.status(500).json({ error: 'External API authentication error' });
    }
  };
}

module.exports = { createExternalApiAuth, EXTERNAL_ROLES, normalizeAllowedMediaTypes };
