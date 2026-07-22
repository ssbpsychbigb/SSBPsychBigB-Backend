'use strict';

const { Router } = require('express');
const { adminApprovalsController } = require('./admin-approvals.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin approval queue routes.
 *
 * GET  /admin/approvals/pending
 * POST /admin/approvals/:userId/approve
 * POST /admin/approvals/:userId/reject
 */
const adminApprovalsRouter = Router();

adminApprovalsRouter.use(requireAdminAuth);

adminApprovalsRouter.get(
  '/pending',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
  ),
  adminApprovalsController.listPending,
);

adminApprovalsRouter.post(
  '/:userId/approve',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
  ),
  adminApprovalsController.approve,
);

adminApprovalsRouter.post(
  '/:userId/reject',
  requireAdminPermission(
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
  ),
  adminApprovalsController.reject,
);

module.exports = { adminApprovalsRouter };
