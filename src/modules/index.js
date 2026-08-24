'use strict';

/**
 * Module registry — mount each domain feature here as the project grows.
 *
 * Naming convention per module:
 *   modules/<feature>/
 *     <feature>.model.js
 *     <feature>.repository.js   (optional: isolate DB queries)
 *     <feature>.service.js
 *     <feature>.controller.js
 *     <feature>.routes.js
 *     <feature>.validation.js   (optional: request schemas)
 */

const { healthRouter } = require('./health/health.routes');
const { authRouter } = require('./auth/auth.routes');
const { adminAuthRouter } = require('./admin-auth/admin-auth.routes');
const { adminApprovalsRouter } = require('./admin-approvals/admin-approvals.routes');
const { adminUsersRouter } = require('./admin-users/admin-users.routes');
const { adminStaffRouter } = require('./admin-staff/admin-staff.routes');
const { instituteTeamRouter } = require('./institute-team/institute-team.routes');
const { feedRouter } = require('./feed/feed.routes');
const { adminFeedRouter } = require('./admin-feed/admin-feed.routes');
const { profileRouter } = require('./profile/profile.routes');
const { notificationRouter } = require('./notifications/notification.routes');
const { chatRouter } = require('./chat/chat.routes');
const { communityRouter } = require('./community/community.routes');

module.exports = {
  healthRouter,
  authRouter,
  adminAuthRouter,
  adminApprovalsRouter,
  adminUsersRouter,
  adminStaffRouter,
  instituteTeamRouter,
  feedRouter,
  adminFeedRouter,
  profileRouter,
  notificationRouter,
  chatRouter,
  communityRouter,
};
