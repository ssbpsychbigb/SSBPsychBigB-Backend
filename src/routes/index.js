'use strict';

const { Router } = require('express');
const {
  healthRouter,
  authRouter,
  adminAuthRouter,
  adminApprovalsRouter,
  adminUsersRouter,
  adminStaffRouter,
  instituteTeamRouter,
  feedRouter,
  adminFeedRouter,
  adminChatRouter,
  profileRouter,
  notificationRouter,
  chatRouter,
  communityRouter,
  dayBriefRouter,
  adminNotificationsRouter,
} = require('../modules');

/**
 * Versioned API router. New domain modules are mounted here.
 */
const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// * Admin portal APIs — JWT must carry portal: "admin"
apiRouter.use('/admin/auth', adminAuthRouter);
apiRouter.use('/admin/approvals', adminApprovalsRouter);
apiRouter.use('/admin/users', adminUsersRouter);
apiRouter.use('/admin/staff', adminStaffRouter);
apiRouter.use('/admin/feed', adminFeedRouter);
apiRouter.use('/admin/chat', adminChatRouter);
apiRouter.use('/admin/notifications', adminNotificationsRouter);

// * Institute panel APIs — JWT must carry portal: "app"
apiRouter.use('/institute/team', instituteTeamRouter);

// * User Profile & Defence Identity — Module 3
apiRouter.use('/profile', profileRouter);

// * In-app notifications — Phase C (follow events)
apiRouter.use('/notifications', notificationRouter);

// * Chat / Messaging — Phase M1 REST
apiRouter.use('/chat', chatRouter);

// * Communities — Module 5 MVP
apiRouter.use('/communities', communityRouter);

// * Day Brief — 24h Home strip stories
apiRouter.use('/day-briefs', dayBriefRouter);

// * Social Feed — Module 4 (routes: /feed/*, /posts/*)
apiRouter.use(feedRouter);

// ! Dev-only: email test + template preview routes
if (process.env.NODE_ENV !== 'production') {
  const { mailTestRouter } = require('../common/mail/mail.test-route');
  apiRouter.use('/dev/mail', mailTestRouter);
}

module.exports = { apiRouter };
