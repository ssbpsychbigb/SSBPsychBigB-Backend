'use strict';

const { Router } = require('express');
const {
  requireAdminAuth,
  requireAdminPermission,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');
const { createRateLimiter } = require('../../common/middleware/rateLimit');
const { adminNotificationsController } = require('./admin-notifications.controller');

/**
 * Admin notifications — mounted at /api/v1/admin/notifications
 */
const adminNotificationsRouter = Router();

adminNotificationsRouter.use(requireAdminAuth);
adminNotificationsRouter.use(
  requireAdminPermission(ADMIN_PERMISSIONS.NOTIFICATIONS_MANAGE),
);

const limitBroadcast = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'admin:broadcast',
  message: 'Too many broadcasts. Please wait.',
});

adminNotificationsRouter.post(
  '/broadcast',
  limitBroadcast,
  adminNotificationsController.broadcast,
);
adminNotificationsRouter.get(
  '/broadcasts',
  adminNotificationsController.list,
);
adminNotificationsRouter.delete(
  '/broadcasts/:id',
  adminNotificationsController.cancel,
);

module.exports = { adminNotificationsRouter };
