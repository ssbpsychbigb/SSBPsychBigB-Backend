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

// * Institute panel APIs — JWT must carry portal: "app"
apiRouter.use('/institute/team', instituteTeamRouter);

// ! Dev-only: email test + template preview routes
if (process.env.NODE_ENV !== 'production') {
  const { mailTestRouter } = require('../common/mail/mail.test-route');
  apiRouter.use('/dev/mail', mailTestRouter);
}

module.exports = { apiRouter };
