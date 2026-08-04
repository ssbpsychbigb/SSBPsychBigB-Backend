'use strict';

const { Router } = require('express');
const { feedController } = require('../feed/feed.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
  requireSuperAdmin,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin Feed moderation — recommendations, reports, trash, permanent delete.
 */
const adminFeedRouter = Router();

adminFeedRouter.use(requireAdminAuth);

adminFeedRouter.get(
  '/recommendations/pending',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
    ADMIN_PERMISSIONS.EDUCATOR_VERIFY,
  ),
  feedController.listPendingRecommendations,
);

adminFeedRouter.post(
  '/recommendations/:postId/verify',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
    ADMIN_PERMISSIONS.EDUCATOR_VERIFY,
  ),
  feedController.verifyAchievement,
);

adminFeedRouter.get(
  '/reports',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
    ADMIN_PERMISSIONS.EDUCATOR_VERIFY,
  ),
  feedController.listReportedPosts,
);

/**
 * Soft-delete trash queue + restore / permanent delete — super admin only.
 * `requireSuperAdmin` loads `req.admin` (JWT alone does not).
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
