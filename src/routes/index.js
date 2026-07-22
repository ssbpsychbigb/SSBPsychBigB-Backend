'use strict';

const { Router } = require('express');
const {
  healthRouter,
  authRouter,
  adminAuthRouter,
  adminApprovalsRouter,
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

module.exports = { apiRouter };
