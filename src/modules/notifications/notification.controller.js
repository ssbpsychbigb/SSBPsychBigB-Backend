'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { AppError } = require('../../common/errors/AppError');
const { notificationService } = require('./notification.service');
const pushService = require('./push.service');

/**
 * In-app notification HTTP handlers (+ prefs / push — Wave 5).
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

  getPreferences = asyncHandler(async (req, res) => {
    const data = await notificationService.getPreferences(req.appUser._id);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Notification preferences',
      data,
    });
  });

  updatePreferences = asyncHandler(async (req, res) => {
    const data = await notificationService.updatePreferences(
      req.appUser._id,
      req.body || {},
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Preferences updated',
      data,
    });
  });

  pushPublicKey = asyncHandler(async (req, res) => {
    const publicKey = pushService.getPublicKey();
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'VAPID public key',
      data: {
        publicKey,
        configured: pushService.isPushConfigured(),
      },
    });
  });

  pushSubscribe = asyncHandler(async (req, res) => {
    if (!pushService.isPushConfigured()) {
      throw new AppError(
        'Web push is not configured on this server',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        { code: 'PUSH_NOT_CONFIGURED' },
      );
    }
    await pushService.saveSubscription({
      userId: req.appUser._id,
      subscription: req.body?.subscription || req.body,
      userAgent: req.get('user-agent') || '',
    });
    await notificationService.updatePreferences(req.appUser._id, {
      pushEnabled: true,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Push subscription saved',
      data: { subscribed: true },
    });
  });

  pushUnsubscribe = asyncHandler(async (req, res) => {
    const data = await pushService.removeSubscription({
      userId: req.appUser._id,
      endpoint: req.body?.endpoint || null,
    });
    if (!req.body?.endpoint) {
      await notificationService.updatePreferences(req.appUser._id, {
        pushEnabled: false,
      });
    }
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Push subscription removed',
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
