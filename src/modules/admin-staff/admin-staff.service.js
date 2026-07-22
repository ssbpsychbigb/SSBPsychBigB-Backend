'use strict';

const bcrypt = require('bcryptjs');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const {
  normalizeMobile,
  isValidIndianMobile,
} = require('../../common/utils/otp');
const { AdminUser } = require('../admin-auth/admin-user.model');
const { toPublicAdmin } = require('../admin-auth/admin-auth.service');
const {
  ADMIN_ROLES,
  ASSIGNABLE_ADMIN_ROLES,
  ACCOUNT_STATUS,
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_META,
  ROLE_DEFAULT_PERMISSIONS,
} = require('../auth/auth.constants');

const ALL_PERMISSION_CODES = new Set(Object.values(ADMIN_PERMISSIONS));

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function sanitizePermissions(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set();
  for (const code of input) {
    const value = String(code || '').trim();
    if (ALL_PERMISSION_CODES.has(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

/**
 * Super Admin staff directory — create / edit Platform Admin & Moderator.
 */
class AdminStaffService {
  /**
   * Catalog for the create/edit UI (defaults + labels).
   */
  getPermissionCatalog() {
    const permissions = Object.values(ADMIN_PERMISSIONS).map((code) => ({
      code,
      ...(ADMIN_PERMISSION_META[code] || {
        label: code,
        description: '',
        group: 'Other',
      }),
    }));

    return {
      permissions,
      roleDefaults: {
        [ADMIN_ROLES.PLATFORM_ADMIN]: [
          ...(ROLE_DEFAULT_PERMISSIONS[ADMIN_ROLES.PLATFORM_ADMIN] || []),
        ],
        [ADMIN_ROLES.PLATFORM_MODERATOR]: [
          ...(ROLE_DEFAULT_PERMISSIONS[ADMIN_ROLES.PLATFORM_MODERATOR] || []),
        ],
      },
      assignableRoles: [...ASSIGNABLE_ADMIN_ROLES],
    };
  }

  /**
   * Lists Platform Admin / Moderator only (never Super Admin seed accounts).
   */
  async listStaff() {
    const staff = await AdminUser.find({
      accountStatus: { $ne: ACCOUNT_STATUS.DELETED },
      role: { $ne: ADMIN_ROLES.SUPER_ADMIN },
    })
      .sort({ createdAt: -1 })
      .limit(200);

    return staff.map(toPublicAdmin);
  }

  /**
   * @param {{
   *   fullName: string,
   *   email: string,
   *   mobileNumber: string,
   *   loginId: string,
   *   password: string,
   *   role: string,
   *   permissions?: string[],
   *   actor: import('mongoose').Document,
   * }} input
   */
  async createStaff({
    fullName,
    email,
    mobileNumber,
    loginId,
    password,
    role,
    permissions,
    actor,
  }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can create admin staff.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const nextRole = String(role || '').trim();
    if (!ASSIGNABLE_ADMIN_ROLES.includes(nextRole)) {
      throw new AppError(
        'Role must be platform_admin or platform_moderator.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_ADMIN_ROLE' },
      );
    }

    const normalizedLoginId = String(loginId || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedMobile = normalizeMobile(mobileNumber);
    const name = String(fullName || '').trim();
    const rawPassword = String(password || '');

    if (!name || name.length < 2) {
      throw new AppError('Enter a full name.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_NAME',
      });
    }

    if (!normalizedLoginId || normalizedLoginId.length < 3) {
      throw new AppError(
        'Login ID must be at least 3 characters.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_LOGIN_ID' },
      );
    }

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new AppError('Enter a valid email.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_EMAIL',
      });
    }

    if (!isValidIndianMobile(normalizedMobile)) {
      throw new AppError(
        'Enter a valid 10-digit Indian mobile number.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_MOBILE' },
      );
    }

    if (rawPassword.length < 8) {
      throw new AppError(
        'Password must be at least 8 characters.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'WEAK_PASSWORD' },
      );
    }

    const defaults = ROLE_DEFAULT_PERMISSIONS[nextRole] || [];
    const nextPermissions =
      permissions === undefined
        ? [...defaults]
        : sanitizePermissions(permissions);

    // * Staff cannot receive staff-manage unless Super Admin (never for PA/PM).
    const safePermissions = nextPermissions.filter(
      (code) => code !== ADMIN_PERMISSIONS.STAFF_MANAGE,
    );

    const passwordHash = await bcrypt.hash(rawPassword, 12);

    try {
      const admin = await AdminUser.create({
        fullName: name,
        email: normalizedEmail,
        mobileNumber: normalizedMobile,
        loginId: normalizedLoginId,
        passwordHash,
        role: nextRole,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        permissions: safePermissions,
      });

      return toPublicAdmin(admin);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'Login ID, email, or mobile number is already in use.',
          HTTP_STATUS.CONFLICT,
          { code: 'ADMIN_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * @param {{
   *   staffId: string,
   *   fullName?: string,
   *   mobileNumber?: string,
   *   permissions?: string[],
   *   accountStatus?: string,
   *   password?: string,
   *   actor: import('mongoose').Document,
   * }} input
   */
  async updateStaff({
    staffId,
    fullName,
    mobileNumber,
    permissions,
    accountStatus,
    password,
    actor,
  }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can update admin staff.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const staff = await AdminUser.findById(staffId).select('+passwordHash');
    if (!staff || staff.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('Admin staff not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'STAFF_NOT_FOUND',
      });
    }

    if (String(staff._id) === String(actor._id)) {
      throw new AppError(
        'You cannot edit your own Super Admin account here.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_EDIT_SELF' },
      );
    }

    if (staff.role === ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Super Admin accounts cannot be edited from Staff.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_EDIT_SUPER_ADMIN' },
      );
    }

    if (fullName !== undefined) {
      const name = String(fullName || '').trim();
      if (!name || name.length < 2) {
        throw new AppError('Enter a full name.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_NAME',
        });
      }
      staff.fullName = name;
    }

    if (mobileNumber !== undefined) {
      const normalizedMobile = normalizeMobile(mobileNumber);
      if (!isValidIndianMobile(normalizedMobile)) {
        throw new AppError(
          'Enter a valid 10-digit Indian mobile number.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_MOBILE' },
        );
      }
      staff.mobileNumber = normalizedMobile;
    }

    if (permissions !== undefined) {
      const next = sanitizePermissions(permissions).filter(
        (code) => code !== ADMIN_PERMISSIONS.STAFF_MANAGE,
      );
      staff.permissions = next;
    }

    if (accountStatus !== undefined) {
      const nextStatus = String(accountStatus || '').trim();
      if (
        nextStatus !== ACCOUNT_STATUS.ACTIVE &&
        nextStatus !== ACCOUNT_STATUS.SUSPENDED
      ) {
        throw new AppError(
          'Status must be active or suspended.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_STATUS' },
        );
      }
      staff.accountStatus = nextStatus;
    }

    if (password !== undefined && String(password).length > 0) {
      const rawPassword = String(password);
      if (rawPassword.length < 8) {
        throw new AppError(
          'Password must be at least 8 characters.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'WEAK_PASSWORD' },
        );
      }
      staff.passwordHash = await bcrypt.hash(rawPassword, 12);
    }

    try {
      await staff.save();
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'Mobile number is already in use.',
          HTTP_STATUS.CONFLICT,
          { code: 'ADMIN_DUPLICATE' },
        );
      }
      throw error;
    }

    return toPublicAdmin(staff);
  }

  /**
   * Soft-delete — removes from Staff list and blocks login.
   *
   * @param {{ staffId: string, actor: import('mongoose').Document }} input
   */
  async removeStaff({ staffId, actor }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can remove admin staff.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const staff = await AdminUser.findById(staffId);
    if (!staff || staff.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('Admin staff not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'STAFF_NOT_FOUND',
      });
    }

    if (String(staff._id) === String(actor._id)) {
      throw new AppError(
        'You cannot remove your own account.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_REMOVE_SELF' },
      );
    }

    if (staff.role === ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Super Admin accounts cannot be removed from Staff.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_REMOVE_SUPER_ADMIN' },
      );
    }

    staff.accountStatus = ACCOUNT_STATUS.DELETED;
    await staff.save();
    return toPublicAdmin(staff);
  }
}

module.exports = {
  adminStaffService: new AdminStaffService(),
};
