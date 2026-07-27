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
  FREELANCER_MASTER_PERMISSIONS,
  VERIFICATION_LEVEL_ON_APPROVE,
  REJECTION_FIELDS_BY_ROLE,
} = require('../auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
} = require('../educator-profile/educator-profile.model');
const { ensureInstituteCode } = require('../educator-profile/institute-code.util');
const { mailService } = require('../../common/mail/mail.service');

/** Roles that appear in the platform verification queue. */
const APPROVAL_QUEUE_ROLES = [
  APP_ROLES.INSTITUTE,
  APP_ROLES.DEFENCE_OFFICER,
  APP_ROLES.EDUCATOR,
];

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
    profilePhotoPath: json.profilePhotoPath || undefined,
    idDocumentPath: json.idDocumentPath || undefined,
    examGoals: Array.isArray(json.examGoals) ? json.examGoals : [],
    rejectionReason: json.rejectionReason || undefined,
    rejectedFields: Array.isArray(json.rejectedFields)
      ? json.rejectedFields
      : [],
    previousRejectionReason: json.previousRejectionReason || undefined,
    previousRejectedFields: Array.isArray(json.previousRejectedFields)
      ? json.previousRejectedFields
      : [],
    resubmittedAt: json.resubmittedAt || undefined,
    resubmissionCount: Number(json.resubmissionCount) || 0,
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

  if (
    roleToReview === APP_ROLES.EDUCATOR &&
    !granted.has(ADMIN_PERMISSIONS.EDUCATOR_VERIFY)
  ) {
    throw new AppError(
      'You do not have permission to review educator applications.',
      HTTP_STATUS.FORBIDDEN,
      { code: 'FORBIDDEN' },
    );
  }
}

/**
 * @param {string} role
 * @param {unknown} fieldsInput
 * @returns {string[]}
 */
function normalizeRejectedFields(role, fieldsInput) {
  const allowed = new Set(REJECTION_FIELDS_BY_ROLE[role] || []);
  const raw = Array.isArray(fieldsInput) ? fieldsInput : [];
  const unique = [
    ...new Set(
      raw
        .map((value) => String(value || '').trim())
        .filter((value) => value.length > 0),
    ),
  ];

  if (unique.length === 0) {
    throw new AppError(
      'Select at least one field that needs correction.',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'INVALID_REJECTED_FIELDS' },
    );
  }

  const invalid = unique.filter((code) => !allowed.has(code));
  if (invalid.length > 0) {
    throw new AppError(
      `Invalid rejection field(s): ${invalid.join(', ')}.`,
      HTTP_STATUS.BAD_REQUEST,
      { code: 'INVALID_REJECTED_FIELDS', details: { invalid } },
    );
  }

  return unique;
}

/**
 * True when this educator user is a public freelancer applicant (not faculty).
 * @param {import('mongoose').Document} user
 */
function isFreelancerApplicant(user) {
  return user.role === APP_ROLES.EDUCATOR && !user.instituteId;
}

function roleLabel(role) {
  if (role === APP_ROLES.EDUCATOR) return 'freelancer educator';
  if (role === APP_ROLES.DEFENCE_OFFICER) return 'defence officer';
  if (role === APP_ROLES.INSTITUTE) return 'institute';
  return role;
}

/**
 * Syncs freelancer EducatorProfile status with User approval actions.
 * @param {{
 *   user: import('mongoose').Document,
 *   status: string,
 *   adminId: unknown,
 *   permissions?: string[],
 * }} input
 */
async function syncFreelancerProfile({ user, status, adminId, permissions }) {
  if (!isFreelancerApplicant(user)) {
    return;
  }

  const profile = await EducatorProfile.findOne({
    userId: user._id,
    type: EDUCATOR_PROFILE_TYPES.FREELANCER,
    status: { $ne: EDUCATOR_PROFILE_STATUSES.DELETED },
  });

  if (!profile) {
    return;
  }

  profile.status = status;
  profile.displayName = user.fullName || profile.displayName;
  profile.examGoals = Array.isArray(user.examGoals) ? [...user.examGoals] : [];
  profile.profilePhotoPath = user.profilePhotoPath || '';
  profile.idDocumentPath = user.idDocumentPath || '';
  profile.rejectionReason = user.rejectionReason || '';
  profile.rejectedFields = Array.isArray(user.rejectedFields)
    ? [...user.rejectedFields]
    : [];
  profile.previousRejectionReason = user.previousRejectionReason || '';
  profile.previousRejectedFields = Array.isArray(user.previousRejectedFields)
    ? [...user.previousRejectedFields]
    : [];
  profile.resubmittedAt = user.resubmittedAt || null;
  profile.resubmissionCount = Number(user.resubmissionCount) || 0;
  profile.reviewedAt = user.reviewedAt || null;
  profile.reviewedByAdminId = adminId || null;

  if (permissions) {
    profile.permissions = [...permissions];
  }

  if (status === EDUCATOR_PROFILE_STATUSES.ACTIVE) {
    profile.activatedAt = new Date();
  }

  await profile.save();
}

/**
 * Platform approval queue for institute + defence officer + freelancer educator.
 */
class AdminApprovalsService {
  /**
   * @param {{ type?: string, status?: string }} query
   */
  async list({ type, status } = {}) {
    const queueStatus =
      status === 'rejected'
        ? ACCOUNT_STATUS.REJECTED
        : ACCOUNT_STATUS.PENDING_VERIFICATION;

    /** @type {Record<string, unknown>} */
    const filter = {
      accountStatus: queueStatus,
      role: { $in: APPROVAL_QUEUE_ROLES },
      // * Invited institute faculty share role=educator — exclude them from this queue.
      $or: [
        { role: { $in: [APP_ROLES.INSTITUTE, APP_ROLES.DEFENCE_OFFICER] } },
        { role: APP_ROLES.EDUCATOR, instituteId: null },
      ],
    };

    if (type === 'institute') {
      filter.role = APP_ROLES.INSTITUTE;
      delete filter.$or;
    } else if (type === 'defence_officer') {
      filter.role = APP_ROLES.DEFENCE_OFFICER;
      delete filter.$or;
    } else if (type === 'educator') {
      filter.role = APP_ROLES.EDUCATOR;
      filter.instituteId = null;
      delete filter.$or;
    }

    const sort =
      queueStatus === ACCOUNT_STATUS.REJECTED
        ? { reviewedAt: -1, updatedAt: -1 }
        : { createdAt: 1 };

    const users = await User.find(filter).sort(sort);
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

    const isQueueCandidate =
      user.role === APP_ROLES.INSTITUTE ||
      user.role === APP_ROLES.DEFENCE_OFFICER ||
      isFreelancerApplicant(user);

    if (!isQueueCandidate) {
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
    if (user.role === APP_ROLES.INSTITUTE) {
      user.permissions = [
        ...(ROLE_DEFAULT_PERMISSIONS[APP_ROLES.INSTITUTE] || []),
      ];
    }
    if (isFreelancerApplicant(user)) {
      user.permissions = [...FREELANCER_MASTER_PERMISSIONS];
    }
    user.rejectionReason = '';
    user.rejectedFields = [];
    user.previousRejectionReason = '';
    user.previousRejectedFields = [];
    user.resubmittedAt = null;
    user.resubmissionCount = 0;
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;
    await user.save();

    if (user.role === APP_ROLES.INSTITUTE) {
      await ensureInstituteCode(user);
    }

    await syncFreelancerProfile({
      user,
      status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
      adminId: admin._id,
      permissions: isFreelancerApplicant(user)
        ? [...FREELANCER_MASTER_PERMISSIONS]
        : undefined,
    });

    void mailService.notifyApplicationApproved({
      to: user.email,
      name: user.fullName || user.instituteName || 'there',
      roleLabel: roleLabel(user.role),
    });

    return toApprovalItem(user);
  }

  /**
   * @param {{
   *   userId: string,
   *   admin: import('mongoose').Document,
   *   reason?: string,
   *   rejectedFields?: unknown,
   * }} input
   */
  async reject({ userId, admin, reason, rejectedFields }) {
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError('Application not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'APPLICATION_NOT_FOUND',
      });
    }

    const isQueueCandidate =
      user.role === APP_ROLES.INSTITUTE ||
      user.role === APP_ROLES.DEFENCE_OFFICER ||
      isFreelancerApplicant(user);

    if (!isQueueCandidate) {
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

    const fields = normalizeRejectedFields(user.role, rejectedFields);

    user.accountStatus = ACCOUNT_STATUS.REJECTED;
    user.rejectionReason = trimmedReason;
    user.rejectedFields = fields;
    // * Fresh rejection cycle — clear active resubmit markers.
    user.resubmittedAt = null;
    user.reviewedAt = new Date();
    user.reviewedByAdminId = admin._id;
    await user.save();

    await syncFreelancerProfile({
      user,
      status: EDUCATOR_PROFILE_STATUSES.REJECTED,
      adminId: admin._id,
    });

    void mailService.notifyApplicationRejected({
      to: user.email,
      name: user.fullName || user.instituteName || 'there',
      roleLabel: roleLabel(user.role),
      reason: trimmedReason,
    });

    return toApprovalItem(user);
  }
}

module.exports = {
  adminApprovalsService: new AdminApprovalsService(),
};
