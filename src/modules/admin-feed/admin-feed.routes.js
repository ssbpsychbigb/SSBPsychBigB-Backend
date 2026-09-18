'use strict';

const { Router } = require('express');
const { feedController } = require('../feed/feed.controller');
const { adminModerationController } = require('./admin-moderation.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
  requireSuperAdmin,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin Feed — verification, reports, moderation actions, trash.
 */
const adminFeedRouter = Router();

adminFeedRouter.use(requireAdminAuth);

const requireVerify = requireAdminPermission(
  ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
  ADMIN_PERMISSIONS.OFFICER_VERIFY,
  ADMIN_PERMISSIONS.EDUCATOR_VERIFY,
);

const requireModeration = requireAdminPermission(ADMIN_PERMISSIONS.MODERATION);

adminFeedRouter.get(
  '/recommendations/pending',
  requireVerify,
  feedController.listPendingRecommendations,
);

adminFeedRouter.post(
  '/recommendations/:postId/verify',
  requireVerify,
  feedController.verifyAchievement,
);

adminFeedRouter.get('/reports', requireModeration, adminModerationController.listReports);

adminFeedRouter.get(
  '/posts/:postId/comments',
  requireModeration,
  adminModerationController.listComments,
);

adminFeedRouter.post(
  '/posts/:postId/hide',
  requireModeration,
  adminModerationController.hidePost,
);

adminFeedRouter.post(
  '/posts/:postId/unhide',
  requireModeration,
  adminModerationController.unhidePost,
);

adminFeedRouter.post(
  '/posts/:postId/lock-comments',
  requireModeration,
  adminModerationController.lockComments,
);

adminFeedRouter.post(
  '/posts/:postId/unlock-comments',
  requireModeration,
  adminModerationController.unlockComments,
);

adminFeedRouter.post(
  '/posts/:postId/reports',
  requireModeration,
  adminModerationController.resolveReports,
);

adminFeedRouter.post(
  '/comments/:commentId/hide',
  requireModeration,
  adminModerationController.hideComment,
);

adminFeedRouter.post(
  '/users/:userId/warn',
  requireModeration,
  adminModerationController.warnUser,
);

/**
 * Soft-delete trash queue + restore / permanent delete — super admin only.
 * Moderators cannot permanently delete posts or accounts (SRS Role 7).
 */
adminFeedRouter.get('/trash', requireSuperAdmin, feedController.listAdminTrash);

adminFeedRouter.post(
  '/posts/:postId/restore',
  requireSuperAdmin,
  feedController.adminRestorePost,
);

adminFeedRouter.delete(
  '/posts/:postId/permanent',
  requireSuperAdmin,
  feedController.permanentDeletePost,
);

module.exports = { adminFeedRouter };
