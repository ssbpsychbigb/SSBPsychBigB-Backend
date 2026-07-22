'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminUsersService } = require('./admin-users.service');

/**
 * Admin user-directory HTTP handlers.
 */
class AdminUsersController {
  /**
   * GET /admin/users
   */
  list = asyncHandler(async (req, res) => {
    const data = await adminUsersService.listUsers({
      role: req.query.role,
      status: req.query.status,
      search: req.query.search,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'App users',
      data,
    });
  });

  /**
   * PATCH /admin/users/:userId/status
   */
  updateStatus = asyncHandler(async (req, res) => {
    const data = await adminUsersService.updateStatus({
      userId: req.params.userId,
      status: req.body.status,
      admin: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'User status updated',
      data,
    });
  });

  /**
   * DELETE /admin/users/:userId
   */
  remove = asyncHandler(async (req, res) => {
    const data = await adminUsersService.softDelete({
      userId: req.params.userId,
      admin: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'User deleted',
      data,
    });
  });
}

module.exports = { adminUsersController: new AdminUsersController() };
