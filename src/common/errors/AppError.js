'use strict';

/**
 * Operational application error with an HTTP status and optional details.
 * Throw this from services/controllers for expected failures.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message.
   * @param {number} statusCode - HTTP status code.
   * @param {{ code?: string, details?: unknown, isOperational?: boolean }} [options]
   */
  constructor(message, statusCode, options = {}) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code || 'APP_ERROR';
    this.details = options.details;
    this.isOperational = options.isOperational !== false;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError };
