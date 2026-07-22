'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { User } = require('../auth/user.model');
const { APP_ROLES, ACCOUNT_STATUS } = require('../auth/auth.constants');

/**
 * @param {import('mongoose').Document} userDoc
 */
function toManagedUser(userDoc) {
  const json = userDoc.toJSON();
  return {
    id: json.id,
    fullName: json.fullName,
    email: json.email,
    mobileNumber: json.mobileNumber,
    role: json.role,
    accountStatus: json.accountStatus,
    verificationLevel: json.verificationLevel,
    instituteName: json.instituteName || undefined,
    isMobileVerified: Boolean(json.isMobileVerified),
    rejectionReason: json.rejectionReason || undefined,
    rejectedFields: Array.isArray(json.rejectedFields)
      ? json.rejectedFields
      : [],
    reviewedAt: json.reviewedAt || undefined,
    createdAt: json.createdAt,
    lastLoginAt: json.lastLoginAt || undefined,
  };
}

const MANAGEABLE_STATUSES = new Set([
  ACCOUNT_STATUS.ACTIVE,
  ACCOUNT_STATUS.SUSPENDED,
  ACCOUNT_STATUS.BANNED,
]);

/**
 * App-portal user directory for admin operators.
 */
class AdminUsersService {
  /**
   * @param {{ role?: string, status?: string, search?: string }} query
   */
  async listUsers({ role, status, search } = {}) {
    /** @type {Record<string, unknown>} */
    const filter = {
      role: {
        $in: [
          APP_ROLES.ASPIRANT,
          APP_ROLES.INSTITUTE,
          APP_ROLES.INSTITUTE_ADMIN,
          APP_ROLES.EDUCATOR,
          APP_ROLES.DEFENCE_OFFICER,
        ],
      },
      accountStatus: { $ne: ACCOUNT_STATUS.DELETED },
    };

    if (
      role === APP_ROLES.ASPIRANT ||
      role === APP_ROLES.INSTITUTE ||
      role === APP_ROLES.INSTITUTE_ADMIN ||
      role === APP_ROLES.EDUCATOR ||
      role === APP_ROLES.DEFENCE_OFFICER
    ) {
      filter.role = role;
    }

    if (status && Object.values(ACCOUNT_STATUS).includes(status)) {
      filter.accountStatus = status;
    }

    const trimmedSearch = String(search || '').trim();
    if (trimmedSearch) {
      const regex = new RegExp(
        trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [
        { fullName: regex },
        { email: regex },
        { mobileNumber: regex },
        { instituteName: regex },
      ];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    return users.map(toManagedUser);
  }

  /**
   * @param {string} userId
   */
  async #findManageableUser(userId) {
    const user = await User.findById(userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    if (
      user.role !== APP_ROLES.ASPIRANT &&
      user.role !== APP_ROLES.INSTITUTE &&
      user.role !== APP_ROLES.DEFENCE_OFFICER
    ) {
      throw new AppError('This account cannot be managed here.', HTTP_STATUS.BAD_REQUEST, {
        code: 'NOT_MANAGEABLE_USER',
      });
    }

    return user;
  }

  /**
   * Suspend (temporary) or ban (severe) — both block app login.
   * Reactivate restores active access.
   *
   * @param {{ userId: string, status: string, admin: import('mongoose').Document }} input
   */
  async updateStatus({ userId, status, admin }) {
    const nextStatus = String(status || '').trim();

    if (!MANAGEABLE_STATUSES.has(nextStatus)) {
      throw new AppError(
        'Status must be active, suspended, or banned.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_STATUS' },
      );
    }

    const user = await this.#findManageableUser(userId);

    if (
      user.accountStatus === ACCOUNT_STATUS.PENDING_VERIFICATION ||
      user.accountStatus === ACCOUNT_STATUS.REJECTED
    ) {
      throw new AppError(
        'Pending or rejected applications are managed from Approvals, not Users.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'USE_APPROVALS_QUEUE' },
      );
    }

    if (user.accountStatus === nextStatus) {
      return toManagedUser(user);
    }

    user.accountStatus = nextStatus;
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;

    if (nextStatus === ACCOUNT_STATUS.ACTIVE) {
      user.rejectionReason = '';
    }

    await user.save();
    return toManagedUser(user);
  }

  /**
   * Soft-delete — removes from directory and permanently blocks login.
   *
   * @param {{ userId: string, admin: import('mongoose').Document }} input
   */
  async softDelete({ userId, admin }) {
    const user = await this.#findManageableUser(userId);

    user.accountStatus = ACCOUNT_STATUS.DELETED;
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;
    await user.save();

    return toManagedUser(user);
  }
}

module.exports = {
  adminUsersService: new AdminUsersService(),
  toManagedUser,
};
