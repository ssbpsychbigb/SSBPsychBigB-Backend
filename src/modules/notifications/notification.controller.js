'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { notificationService } = require('./notification.service');

/**
 * In-app notification HTTP handlers.
 */
class NotificationController {
  list = asyncHandler(async (req, res) => {
    const data = await notificationService.listForUser(req.appUser, {
      cursor: req.query.cursor,
      limit: req.query.limit,
      unreadOnly: req.query.unreadOnly,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Notifications',
      data,
    });
  });

  unreadCount = asyncHandler(async (req, res) => {
    const data = await notificationService.unreadCount(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Unread count',
      data,
    });
  });

  markRead = asyncHandler(async (req, res) => {
    const data = await notificationService.markRead(req.appUser, req.params.id);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Marked as read',
      data,
    });
  });

  markAllRead = asyncHandler(async (req, res) => {
    const data = await notificationService.markAllRead(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'All marked as read',
      data,
    });
  });

  remove = asyncHandler(async (req, res) => {
    const data = await notificationService.remove(req.appUser, req.params.id);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Notification removed',
      data,
    });
  });
}

const notificationController = new NotificationController();

module.exports = { notificationController };
