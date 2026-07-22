'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { authService } = require('./auth.service');

/**
 * Auth HTTP handlers for app-portal OTP registration and login.
 */
class AuthController {
  /**
   * POST /auth/register
   */
  register = asyncHandler(async (req, res) => {
    const data = await authService.startRegistration({
      body: req.body,
      files: req.files || {},
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.message || 'OTP sent',
      data,
    });
  });

  /**
   * POST /auth/otp/send
   */
  sendOtp = asyncHandler(async (req, res) => {
    const data = await authService.sendOtp({
      mobileNumber: req.body.mobileNumber,
      purpose: req.body.purpose,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'OTP sent',
      data,
    });
  });

  /**
   * POST /auth/otp/verify
   */
  verifyOtp = asyncHandler(async (req, res) => {
    const data = await authService.verifyOtp({
      mobileNumber: req.body.mobileNumber,
      otp: req.body.otp,
      purpose: req.body.purpose,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Verified successfully',
      data,
    });
  });

  /**
   * GET /auth/me
   */
  me = asyncHandler(async (req, res) => {
    const data = await authService.getMe(req.auth.sub);

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Current user',
      data,
    });
  });
}

module.exports = { authController: new AuthController() };
