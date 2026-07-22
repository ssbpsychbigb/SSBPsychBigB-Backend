'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminAuthService } = require('./admin-auth.service');

/**
 * Admin portal auth HTTP handlers.
 */
class AdminAuthController {
  /**
   * POST /admin/auth/login
   */
  login = asyncHandler(async (req, res) => {
    const data = await adminAuthService.login({
      loginId: req.body.loginId,
      email: req.body.email,
      identifier: req.body.identifier,
      password: req.body.password,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin signed in',
      data,
    });
  });

  /**
   * GET /admin/auth/me
   */
  me = asyncHandler(async (req, res) => {
    const data = await adminAuthService.getMe(req.auth.sub);

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Current admin',
      data,
    });
  });
}

module.exports = { adminAuthController: new AdminAuthController() };
