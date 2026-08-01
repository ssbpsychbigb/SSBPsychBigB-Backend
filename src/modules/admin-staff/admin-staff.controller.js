'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminStaffService } = require('./admin-staff.service');

/**
 * Admin staff HTTP handlers.
 */
class AdminStaffController {
  /**
   * GET /admin/staff/catalog
   */
  catalog = asyncHandler(async (_req, res) => {
    const data = adminStaffService.getPermissionCatalog();
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Permission catalog',
      data,
    });
  });

  /**
   * GET /admin/staff/roles
   */
  listRoles = asyncHandler(async (req, res) => {
    const data = await adminStaffService.listCustomRoles({ actor: req.admin });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin custom roles',
      data,
    });
  });

  /**
   * POST /admin/staff/roles
   */
  createRole = asyncHandler(async (req, res) => {
    const data = await adminStaffService.createCustomRole({
      actor: req.admin,
      name: req.body.name,
      description: req.body.description,
      permissions: req.body.permissions,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Custom role created',
      data,
    });
  });

  /**
   * PATCH /admin/staff/roles/:roleId
   */
  updateRole = asyncHandler(async (req, res) => {
    const data = await adminStaffService.updateCustomRole({
      actor: req.admin,
      roleId: req.params.roleId,
      name: req.body.name,
      description: req.body.description,
      permissions: req.body.permissions,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Custom role updated',
      data,
    });
  });

  /**
   * DELETE /admin/staff/roles/:roleId
   */
  deleteRole = asyncHandler(async (req, res) => {
    const data = await adminStaffService.deleteCustomRole({
      actor: req.admin,
      roleId: req.params.roleId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Custom role deleted',
      data,
    });
  });

  /**
   * GET /admin/staff
   */
  list = asyncHandler(async (_req, res) => {
    const data = await adminStaffService.listStaff();
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin staff',
      data,
    });
  });

  /**
   * POST /admin/staff
   */
  create = asyncHandler(async (req, res) => {
    const data = await adminStaffService.createStaff({
      fullName: req.body.fullName,
      email: req.body.email,
      mobileNumber: req.body.mobileNumber,
      loginId: req.body.loginId,
      password: req.body.password,
      role: req.body.role,
      permissions: req.body.permissions,
      customRoleId: req.body.customRoleId,
      actor: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Admin staff created',
      data,
    });
  });

  /**
   * PATCH /admin/staff/:staffId
   */
  update = asyncHandler(async (req, res) => {
    const data = await adminStaffService.updateStaff({
      staffId: req.params.staffId,
      fullName: req.body.fullName,
      mobileNumber: req.body.mobileNumber,
      permissions: req.body.permissions,
      customRoleId: req.body.customRoleId,
      accountStatus: req.body.accountStatus,
      password: req.body.password,
      actor: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin staff updated',
      data,
    });
  });

  /**
   * DELETE /admin/staff/:staffId
   */
  remove = asyncHandler(async (req, res) => {
    const data = await adminStaffService.removeStaff({
      staffId: req.params.staffId,
      actor: req.admin,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin staff removed',
      data,
    });
  });
}

module.exports = { adminStaffController: new AdminStaffController() };
