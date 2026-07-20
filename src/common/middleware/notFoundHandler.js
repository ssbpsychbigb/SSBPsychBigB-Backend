'use strict';

const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');

/**
 * Converts unmatched routes into a consistent 404 AppError.
 *
 * @type {import('express').RequestHandler}
 */
function notFoundHandler(req, _res, next) {
  next(
    new AppError(`Route not found: ${req.method} ${req.originalUrl}`, HTTP_STATUS.NOT_FOUND, {
      code: 'ROUTE_NOT_FOUND',
    }),
  );
}

module.exports = { notFoundHandler };
