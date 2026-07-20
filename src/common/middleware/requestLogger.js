'use strict';

const { logger } = require('../utils/logger');

/**
 * Logs method, path, status, and duration for every request.
 *
 * @type {import('express').RequestHandler}
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });

  next();
}

module.exports = { requestLogger };
