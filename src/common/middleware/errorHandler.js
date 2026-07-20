'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../errors/AppError');
const { ApiResponse } = require('../utils/ApiResponse');
const { logger } = require('../utils/logger');
const { HTTP_STATUS } = require('../constants/httpStatus');
const config = require('../../config');

/**
 * Maps known error shapes to a normalized payload.
 *
 * @param {Error & { statusCode?: number, code?: string, details?: unknown, isOperational?: boolean, errors?: Record<string, { message: string }>, keyValue?: Record<string, unknown> }} err
 */
function normalizeError(err) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
      details: err.details,
      isOperational: err.isOperational,
    };
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: Object.values(err.errors).map((e) => e.message),
      isOperational: true,
    };
  }

  if (err instanceof mongoose.Error.CastError) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: `Invalid ${err.path}: ${err.value}`,
      code: 'CAST_ERROR',
      isOperational: true,
    };
  }

  // * Mongo duplicate key
  if (err.code === 11000) {
    return {
      statusCode: HTTP_STATUS.CONFLICT,
      message: 'Duplicate key conflict',
      code: 'DUPLICATE_KEY',
      details: err.keyValue,
      isOperational: true,
    };
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: 'Invalid JSON payload',
      code: 'INVALID_JSON',
      isOperational: true,
    };
  }

  return {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: config.isProduction ? 'Internal server error' : err.message || 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
    isOperational: false,
  };
}

/**
 * Centralized Express error middleware. Must be registered last.
 *
 * @type {import('express').ErrorRequestHandler}
 */
function errorHandler(err, _req, res, _next) {
  const normalized = normalizeError(err);

  if (!normalized.isOperational) {
    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack,
      code: err.code,
    });
  } else {
    logger.warn('Operational error', {
      message: normalized.message,
      code: normalized.code,
      statusCode: normalized.statusCode,
    });
  }

  return ApiResponse.error(res, {
    statusCode: normalized.statusCode,
    message: normalized.message,
    code: normalized.code,
    details: normalized.details,
  });
}

module.exports = { errorHandler };
