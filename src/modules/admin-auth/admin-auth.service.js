'use strict';

const bcrypt = require('bcryptjs');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { signAccessToken } = require('../../common/utils/jwt');
const { AdminUser } = require('./admin-user.model');
const {
  ACCOUNT_STATUS,
  PORTAL,
  ROLE_DEFAULT_PERMISSIONS,
} = require('../auth/auth.constants');

/**
 * @param {import('mongoose').Document} adminDoc
 */
function toPublicAdmin(adminDoc) {
  const json = adminDoc.toJSON();
  return {
    id: json.id,
    loginId: json.loginId,
    email: json.email,
    fullName: json.fullName,
    role: json.role,
    accountStatus: json.accountStatus,
    portal: json.portal,
    permissions: json.permissions || [],
    lastLoginAt: json.lastLoginAt,
    createdAt: json.createdAt,
  };
}

/**
 * Admin-portal password authentication (no OTP).
 */
class AdminAuthService {
  /**
   * @param {{ loginId: string, password: string }} input
   */
  async login({ loginId, password }) {
    const normalizedId = String(loginId || '')
      .trim()
      .toLowerCase();
    const rawPassword = String(password || '');

    if (!normalizedId || !rawPassword) {
      throw new AppError('Login ID and password are required.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_CREDENTIALS_INPUT',
      });
    }

    const admin = await AdminUser.findOne({ loginId: normalizedId }).select(
      '+passwordHash',
    );

    if (!admin) {
      throw new AppError('Invalid login ID or password.', HTTP_STATUS.UNAUTHORIZED, {
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (admin.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
      throw new AppError('This admin account is not active.', HTTP_STATUS.FORBIDDEN, {
        code: 'ADMIN_INACTIVE',
        details: { accountStatus: admin.accountStatus },
      });
    }

    const isMatch = await bcrypt.compare(rawPassword, admin.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid login ID or password.', HTTP_STATUS.UNAUTHORIZED, {
        code: 'INVALID_CREDENTIALS',
      });
    }

    // * Backfill default permissions when role catalog expands.
    const defaults = ROLE_DEFAULT_PERMISSIONS[admin.role] || [];
    if (!admin.permissions?.length && defaults.length) {
      admin.permissions = [...defaults];
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const publicAdmin = toPublicAdmin(admin);

    return {
      accessToken: signAccessToken({
        id: publicAdmin.id,
        loginId: publicAdmin.loginId,
        role: publicAdmin.role,
        portal: PORTAL.ADMIN,
        accountStatus: publicAdmin.accountStatus,
      }),
      admin: publicAdmin,
    };
  }

  /**
   * @param {string} adminId
   */
  async getMe(adminId) {
    const admin = await AdminUser.findById(adminId);

    if (!admin || admin.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('Admin not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'ADMIN_NOT_FOUND',
      });
    }

    return toPublicAdmin(admin);
  }
}

module.exports = {
  adminAuthService: new AdminAuthService(),
  toPublicAdmin,
};
