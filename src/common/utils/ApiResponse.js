'use strict';

/**
 * Standard JSON response envelope for successful API responses.
 */
class ApiResponse {
  /**
   * @param {import('express').Response} res
   * @param {{ statusCode?: number, message?: string, data?: unknown, meta?: unknown }} payload
   */
  static success(res, { statusCode = 200, message = 'Success', data = null, meta } = {}) {
    const body = {
      success: true,
      message,
      data,
    };

    if (meta !== undefined) {
      body.meta = meta;
    }

    return res.status(statusCode).json(body);
  }

  /**
   * @param {import('express').Response} res
   * @param {{ statusCode?: number, message?: string, code?: string, details?: unknown }} payload
   */
  static error(res, { statusCode = 500, message = 'Error', code = 'ERROR', details } = {}) {
    const body = {
      success: false,
      message,
      code,
    };

    if (details !== undefined) {
      body.details = details;
    }

    return res.status(statusCode).json(body);
  }
}

module.exports = { ApiResponse };
