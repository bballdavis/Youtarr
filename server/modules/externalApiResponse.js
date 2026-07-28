const DEFAULT_CODES = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

function externalErrorBody(status, message, { code, requestId } = {}) {
  return {
    error: {
      code: code || DEFAULT_CODES[status] || 'request_failed',
      message,
      ...(requestId ? { requestId } : {}),
    },
  };
}

function sendExternalError(res, status, message, options) {
  return res.status(status).json(externalErrorBody(status, message, options));
}

module.exports = { externalErrorBody, sendExternalError };
