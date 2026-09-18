'use strict';

const { Router } = require('express');
const { adminChatController } = require('./admin-chat.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin chat moderation — CHAT-D05 report investigate queue.
 */
const adminChatRouter = Router();

adminChatRouter.use(requireAdminAuth);

const requireModeration = requireAdminPermission(ADMIN_PERMISSIONS.MODERATION);

adminChatRouter.get(
  '/reports',
  requireModeration,
  adminChatController.listReports,
);

adminChatRouter.get(
  '/reports/:reportId/messages',
  requireModeration,
  adminChatController.listReportMessages,
);

adminChatRouter.post(
  '/reports/:reportId',
  requireModeration,
  adminChatController.resolveReport,
);

module.exports = { adminChatRouter };
