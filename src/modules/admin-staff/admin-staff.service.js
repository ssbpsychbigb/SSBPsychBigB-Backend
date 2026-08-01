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
const { AdminRole } = require('./admin-role.model');

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
 * Staff never receive staff-manage (Super Admin only).
 * @param {string[]} permissions
 */
function stripStaffManage(permissions) {
  return permissions.filter((code) => code !== ADMIN_PERMISSIONS.STAFF_MANAGE);
}

/**
 * @param {string|undefined|null} customRoleId
 */
async function loadAdminCustomRole(customRoleId) {
  const id = String(customRoleId || '').trim();
  if (!id) {
    return null;
  }
  const role = await AdminRole.findOne({ _id: id, isDeleted: false });
  if (!role) {
    throw new AppError('Custom role not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'CUSTOM_ROLE_NOT_FOUND',
    });
  }
  return role;
}

/**
 * @param {{
 *   role: string,
 *   permissions?: unknown,
 *   customRoleId?: string | null,
 * }} input
 */
async function resolveAdminGrantBundle({ role, permissions, customRoleId }) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || [];
  const customRole = await loadAdminCustomRole(customRoleId);

  if (customRole) {
    const fromBody =
      permissions === undefined ? undefined : sanitizePermissions(permissions);
    return {
      permissions: stripStaffManage(
        fromBody === undefined
          ? sanitizePermissions(customRole.permissions)
          : fromBody,
      ),
      customRoleId: customRole._id,
    };
  }

  return {
    permissions: stripStaffManage(
      permissions === undefined
        ? [...defaults]
        : sanitizePermissions(permissions),
    ),
    customRoleId: null,
  };
}

/**
 * @param {import('mongoose').Document} roleDoc
 */
function toAdminCustomRoleSummary(roleDoc) {
  const json = roleDoc.toJSON();
  return {
    id: json.id,
    name: json.name,
    description: json.description || '',
    permissions: Array.isArray(json.permissions) ? json.permissions : [],
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
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
   * @param {{ actor: import('mongoose').Document }} input
   */
  async listCustomRoles({ actor }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can manage custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const rows = await AdminRole.find({ isDeleted: false })
      .sort({ name: 1 })
      .limit(200);
    return rows.map(toAdminCustomRoleSummary);
  }

  /**
   * @param {{
   *   actor: import('mongoose').Document,
   *   name: string,
   *   description?: string,
   *   permissions?: unknown,
   * }} input
   */
  async createCustomRole({ actor, name, description, permissions }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can manage custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const nextName = String(name || '').trim();
    if (!nextName || nextName.length < 2) {
      throw new AppError('Enter a role name.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_ROLE_NAME',
      });
    }

    const nextPermissions = stripStaffManage(
      sanitizePermissions(permissions || []),
    );
    if (nextPermissions.length === 0) {
      throw new AppError(
        'Select at least one permission for this role.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'PERMISSIONS_REQUIRED' },
      );
    }

    try {
      const role = await AdminRole.create({
        name: nextName,
        description: String(description || '').trim().slice(0, 300),
        permissions: nextPermissions,
        createdByAdminId: actor._id,
        isDeleted: false,
      });
      return toAdminCustomRoleSummary(role);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'A custom role with this name already exists.',
          HTTP_STATUS.CONFLICT,
          { code: 'CUSTOM_ROLE_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * @param {{
   *   actor: import('mongoose').Document,
   *   roleId: string,
   *   name?: string,
   *   description?: string,
   *   permissions?: unknown,
   * }} input
   */
  async updateCustomRole({
    actor,
    roleId,
    name,
    description,
    permissions,
  }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can manage custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const role = await loadAdminCustomRole(roleId);

    if (name !== undefined) {
      const nextName = String(name || '').trim();
      if (!nextName || nextName.length < 2) {
        throw new AppError('Enter a role name.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_ROLE_NAME',
        });
      }
      role.name = nextName;
    }

    if (description !== undefined) {
      role.description = String(description || '').trim().slice(0, 300);
    }

    if (permissions !== undefined) {
      const nextPermissions = stripStaffManage(
        sanitizePermissions(permissions || []),
      );
      if (nextPermissions.length === 0) {
        throw new AppError(
          'Select at least one permission for this role.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'PERMISSIONS_REQUIRED' },
        );
      }
      role.permissions = nextPermissions;
    }

    try {
      await role.save();
      return toAdminCustomRoleSummary(role);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'A custom role with this name already exists.',
          HTTP_STATUS.CONFLICT,
          { code: 'CUSTOM_ROLE_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * @param {{ actor: import('mongoose').Document, roleId: string }} input
   */
  async deleteCustomRole({ actor, roleId }) {
    if (actor.role !== ADMIN_ROLES.SUPER_ADMIN) {
      throw new AppError(
        'Only Super Admin can manage custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'SUPER_ADMIN_ONLY' },
      );
    }

    const role = await loadAdminCustomRole(roleId);
    role.isDeleted = true;
    await role.save();

    await AdminUser.updateMany(
      { customRoleId: role._id },
      { $set: { customRoleId: null } },
    );

    return { id: String(role._id), deleted: true };
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
   *   customRoleId?: string,
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
    customRoleId,
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

    const grant = await resolveAdminGrantBundle({
      role: nextRole,
      permissions,
      customRoleId,
    });

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
        permissions: grant.permissions,
        customRoleId: grant.customRoleId,
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
   *   customRoleId?: string | null,
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
    customRoleId,
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

    if (permissions !== undefined || customRoleId !== undefined) {
      if (customRoleId === '' || customRoleId === null) {
        staff.customRoleId = null;
        if (permissions !== undefined) {
          staff.permissions = stripStaffManage(
            sanitizePermissions(permissions),
          );
        }
      } else {
        const grant = await resolveAdminGrantBundle({
          role: staff.role,
          permissions:
            permissions !== undefined ? permissions : staff.permissions,
          customRoleId:
            customRoleId !== undefined
              ? customRoleId
              : staff.customRoleId
                ? String(staff.customRoleId)
                : undefined,
        });
        staff.permissions = grant.permissions;
        staff.customRoleId = grant.customRoleId;
      }
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
