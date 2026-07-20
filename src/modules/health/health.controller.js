'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { healthService } = require('./health.service');

/**
 * Health check HTTP handlers.
 */
class HealthController {
  /**
   * GET /health
   */
  getHealth = asyncHandler(async (_req, res) => {
    const data = healthService.getStatus();

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Service is healthy',
      data,
    });
  });
}

module.exports = { healthController: new HealthController() };
