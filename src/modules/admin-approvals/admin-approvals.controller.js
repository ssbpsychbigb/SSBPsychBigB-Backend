'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminApprovalsService } = require('./admin-approvals.service');

/**
 * Admin approval queue HTTP handlers.
 */
class AdminApprovalsController {
  /**
   * GET /admin/approvals/pending
   */
  listPending = asyncHandler(async (req, res) => {
    const data = await adminApprovalsService.listPending({
      type: req.query.type,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Pending approvals',
      data,
    });
  });

  /**
   * POST /admin/approvals/:userId/approve
   */
  approve = asyncHandler(async (req, res) => {
    const data = await adminApprovalsService.approve({
      userId: req.params.userId,
      admin: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Application approved',
      data,
    });
  });

  /**
   * POST /admin/approvals/:userId/reject
   */
  reject = asyncHandler(async (req, res) => {
    const data = await adminApprovalsService.reject({
      userId: req.params.userId,
      admin: req.admin,
      reason: req.body.reason,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Application rejected',
      data,
    });
  });
}

module.exports = { adminApprovalsController: new AdminApprovalsController() };
