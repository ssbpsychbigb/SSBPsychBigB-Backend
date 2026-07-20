'use strict';

/**
 * Wraps async route handlers so rejected promises reach the error middleware.
 * Express 5 forwards rejected promises automatically; this keeps handlers uniform
 * and remains safe if a route uses a sync throw or nested promise.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown> | unknown} fn
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
