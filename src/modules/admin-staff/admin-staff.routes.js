'use strict';

const { Router } = require('express');
const { adminStaffController } = require('./admin-staff.controller');
const {
  requireAdminAuth,
  requireAdminPermission,
} = require('../../common/middleware/requireAdminAuth');
const { ADMIN_PERMISSIONS } = require('../auth/auth.constants');

/**
 * Admin staff routes — Super Admin only (via STAFF_MANAGE + service checks).
 *
 * GET    /admin/staff/catalog
 * GET    /admin/staff/roles
 * POST   /admin/staff/roles
 * PATCH  /admin/staff/roles/:roleId
 * DELETE /admin/staff/roles/:roleId
 * GET    /admin/staff
 * POST   /admin/staff
 * PATCH  /admin/staff/:staffId
 * DELETE /admin/staff/:staffId
 */
const adminStaffRouter = Router();

adminStaffRouter.use(requireAdminAuth);
adminStaffRouter.use(requireAdminPermission(ADMIN_PERMISSIONS.STAFF_MANAGE));

adminStaffRouter.get('/catalog', adminStaffController.catalog);
adminStaffRouter.get('/roles', adminStaffController.listRoles);
adminStaffRouter.post('/roles', adminStaffController.createRole);
adminStaffRouter.patch('/roles/:roleId', adminStaffController.updateRole);
adminStaffRouter.delete('/roles/:roleId', adminStaffController.deleteRole);

adminStaffRouter.get('/', adminStaffController.list);
adminStaffRouter.post('/', adminStaffController.create);
adminStaffRouter.patch('/:staffId', adminStaffController.update);
adminStaffRouter.delete('/:staffId', adminStaffController.remove);

module.exports = { adminStaffRouter };
