'use strict';

const { Router } = require('express');
const { notificationController } = require('./notification.controller');
const {
  requireAppAuth,
  requireAppUser,
} = require('../../common/middleware/requireAppAuth');

/**
 * Notification routes — Phase C (follow events).
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
