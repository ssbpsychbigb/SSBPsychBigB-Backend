'use strict';

const { Router } = require('express');
const { adminUsersController } = require('./admin-users.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin app-user directory routes.
 *
 * GET    /admin/users
 * PATCH  /admin/users/:userId/status
 * DELETE /admin/users/:userId
 */
const adminUsersRouter = Router();

adminUsersRouter.use(requireAdminAuth);

adminUsersRouter.get(
  '/',
  requireAdminPermission(ADMIN_PERMISSIONS.USERS_READ),
  adminUsersController.list,
);

adminUsersRouter.patch(
  '/:userId/status',
  requireAdminPermission(ADMIN_PERMISSIONS.USERS_MANAGE),
  adminUsersController.updateStatus,
);

adminUsersRouter.delete(
  '/:userId',
  requireAdminPermission(ADMIN_PERMISSIONS.USERS_MANAGE),
  adminUsersController.remove,
);

module.exports = { adminUsersRouter };
