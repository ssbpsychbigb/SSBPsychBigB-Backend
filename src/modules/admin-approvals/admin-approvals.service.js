'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { User } = require('../auth/user.model');
const {
  ACCOUNT_STATUS,
  APP_ROLES,
  ADMIN_ROLES,
  ADMIN_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  VERIFICATION_LEVEL_ON_APPROVE,
} = require('../auth/auth.constants');

/**
 * @param {import('mongoose').Document} userDoc
 */
function toApprovalItem(userDoc) {
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
    instituteLogoPath: json.instituteLogoPath || undefined,
    officerPhotoPath: json.officerPhotoPath || undefined,
    officerIdDocumentPath: json.officerIdDocumentPath || undefined,
    rejectionReason: json.rejectionReason || undefined,
    reviewedAt: json.reviewedAt || undefined,
    createdAt: json.createdAt,
    isMobileVerified: Boolean(json.isMobileVerified),
  };
}

/**
 * @param {import('mongoose').Document} admin
 * @param {string} roleToReview
 */
function assertCanReviewRole(admin, roleToReview) {
  if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
    return;
  }

  const granted = new Set([
    ...(ROLE_DEFAULT_PERMISSIONS[admin.role] || []),
    ...(admin.permissions || []),
  ]);

  if (
    roleToReview === APP_ROLES.INSTITUTE &&
    !granted.has(ADMIN_PERMISSIONS.INSTITUTE_VERIFY)
  ) {
    throw new AppError(
      'You do not have permission to review institute applications.',
      HTTP_STATUS.FORBIDDEN,
      { code: 'FORBIDDEN' },
    );
  }

  if (
    roleToReview === APP_ROLES.DEFENCE_OFFICER &&
    !granted.has(ADMIN_PERMISSIONS.OFFICER_VERIFY)
  ) {
    throw new AppError(
      'You do not have permission to review officer applications.',
      HTTP_STATUS.FORBIDDEN,
      { code: 'FORBIDDEN' },
    );
  }
}

/**
 * Platform approval queue for institute + defence officer applications.
 */
class AdminApprovalsService {
  /**
   * @param {{ type?: string }} query
   */
  async listPending({ type } = {}) {
    /** @type {Record<string, unknown>} */
    const filter = {
      accountStatus: ACCOUNT_STATUS.PENDING_VERIFICATION,
      role: { $in: [APP_ROLES.INSTITUTE, APP_ROLES.DEFENCE_OFFICER] },
    };

    if (type === 'institute') {
      filter.role = APP_ROLES.INSTITUTE;
    } else if (type === 'defence_officer') {
      filter.role = APP_ROLES.DEFENCE_OFFICER;
    }

    const users = await User.find(filter).sort({ createdAt: 1 });
    return users.map(toApprovalItem);
  }

  /**
   * @param {{ userId: string, admin: import('mongoose').Document }} input
   */
  async approve({ userId, admin }) {
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError('Application not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'APPLICATION_NOT_FOUND',
      });
    }

    if (
      user.role !== APP_ROLES.INSTITUTE &&
      user.role !== APP_ROLES.DEFENCE_OFFICER
    ) {
      throw new AppError('This account is not in the approval queue.', HTTP_STATUS.BAD_REQUEST, {
        code: 'NOT_APPROVAL_CANDIDATE',
      });
    }

    assertCanReviewRole(admin, user.role);

    if (user.accountStatus !== ACCOUNT_STATUS.PENDING_VERIFICATION) {
      throw new AppError(
        `Application is already ${user.accountStatus}.`,
        HTTP_STATUS.CONFLICT,
        { code: 'APPLICATION_NOT_PENDING' },
      );
    }

    user.accountStatus = ACCOUNT_STATUS.ACTIVE;
    user.verificationLevel =
      VERIFICATION_LEVEL_ON_APPROVE[user.role] ?? user.verificationLevel;
    user.rejectionReason = '';
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;
    await user.save();

    return toApprovalItem(user);
  }

  /**
   * @param {{ userId: string, admin: import('mongoose').Document, reason?: string }} input
   */
  async reject({ userId, admin, reason }) {
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError('Application not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'APPLICATION_NOT_FOUND',
      });
    }

    if (
      user.role !== APP_ROLES.INSTITUTE &&
      user.role !== APP_ROLES.DEFENCE_OFFICER
    ) {
      throw new AppError('This account is not in the approval queue.', HTTP_STATUS.BAD_REQUEST, {
        code: 'NOT_APPROVAL_CANDIDATE',
      });
    }

    assertCanReviewRole(admin, user.role);

    if (user.accountStatus !== ACCOUNT_STATUS.PENDING_VERIFICATION) {
      throw new AppError(
        `Application is already ${user.accountStatus}.`,
        HTTP_STATUS.CONFLICT,
        { code: 'APPLICATION_NOT_PENDING' },
      );
    }

    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < 3) {
      throw new AppError(
        'Please provide a rejection reason (at least 3 characters).',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_REJECTION_REASON' },
      );
    }

    user.accountStatus = ACCOUNT_STATUS.REJECTED;
    user.rejectionReason = trimmedReason;
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;
    await user.save();

    return toApprovalItem(user);
  }
}

module.exports = {
  adminApprovalsService: new AdminApprovalsService(),
};
