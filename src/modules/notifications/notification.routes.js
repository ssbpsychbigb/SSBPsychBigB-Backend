'use strict';

const { Router } = require('express');
const { notificationController } = require('./notification.controller');
const {
  requireAppAuth,
  requireAppUser,
} = require('../../common/middleware/requireAppAuth');

/**
 * Notification routes — inbox + prefs + web push (Wave 5).
 */
const notificationRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

notificationRouter.get('/', ...requireActiveAppUser, notificationController.list);
notificationRouter.get(
  '/unread-count',
  ...requireActiveAppUser,
  notificationController.unreadCount,
);
notificationRouter.get(
  '/preferences',
  ...requireActiveAppUser,
  notificationController.getPreferences,
);
notificationRouter.patch(
  '/preferences',
  ...requireActiveAppUser,
  notificationController.updatePreferences,
);
notificationRouter.get(
  '/push/vapid-public-key',
  ...requireActiveAppUser,
  notificationController.pushPublicKey,
);
notificationRouter.post(
  '/push/subscribe',
  ...requireActiveAppUser,
  notificationController.pushSubscribe,
);
notificationRouter.delete(
  '/push/subscribe',
  ...requireActiveAppUser,
  notificationController.pushUnsubscribe,
);
notificationRouter.post(
  '/read-all',
  ...requireActiveAppUser,
  notificationController.markAllRead,
);
notificationRouter.post(
  '/:id/read',
  ...requireActiveAppUser,
  notificationController.markRead,
);
notificationRouter.delete(
  '/:id',
  ...requireActiveAppUser,
  notificationController.remove,
);

module.exports = { notificationRouter };
