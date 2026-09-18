'use strict';

const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');

/**
 * Lightweight in-memory sliding-window rate limiter (per-process).
 * Suitable for single-instance / Phase D hardening; replace with Redis later.
 *
 * @param {{ windowMs: number, max: number, keyPrefix?: string, message?: string }} options
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options) {
  const windowMs = Number(options.windowMs) || 15 * 60 * 1000;
  const max = Number(options.max) || 30;
  const keyPrefix = options.keyPrefix || 'rl';
  const message =
    options.message || 'Too many requests. Please wait and try again.';

  /** @type {Map<string, number[]>} */
  const hits = new Map();

  return function rateLimit(req, _res, next) {
    const userId = req.appUser?._id || req.auth?.sub;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${userId || ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const prior = (hits.get(key) || []).filter((ts) => ts > windowStart);
    if (prior.length >= max) {
      next(
        new AppError(message, HTTP_STATUS.TOO_MANY_REQUESTS || 429, {
          code: 'RATE_LIMITED',
          retryAfterMs: prior[0] + windowMs - now,
        }),
      );
      return;
    }

    prior.push(now);
    hits.set(key, prior);

    if (hits.size > 10_000) {
      for (const [k, stamps] of hits) {
        const kept = stamps.filter((ts) => ts > windowStart);
        if (!kept.length) hits.delete(k);
        else hits.set(k, kept);
      }
    }

    next();
  };
}

module.exports = { createRateLimiter };
