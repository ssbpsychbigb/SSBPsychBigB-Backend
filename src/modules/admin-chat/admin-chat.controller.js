'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminChatService } = require('./admin-chat.service');

class AdminChatController {
  listReports = asyncHandler(async (req, res) => {
    const data = await adminChatService.listReports({
      status: req.query.status,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Chat reports',
      data,
    });
  });

  listReportMessages = asyncHandler(async (req, res) => {
    const data = await adminChatService.listReportMessages(req.params.reportId, {
      before: req.query.before,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Chat report messages',
      data,
    });
  });

  resolveReport = asyncHandler(async (req, res) => {
    const data = await adminChatService.resolveReport({
      admin: req.admin,
      reportId: req.params.reportId,
      outcome: req.body?.outcome,
      note: req.body?.note,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Chat report updated',
      data,
    });
  });
}

const adminChatController = new AdminChatController();

module.exports = { adminChatController };
