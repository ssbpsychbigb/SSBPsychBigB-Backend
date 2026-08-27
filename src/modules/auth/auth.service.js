'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { logger } = require('../../common/utils/logger');
const {
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
  normalizeMobile,
  isValidIndianMobile,
} = require('../../common/utils/otp');
const config = require('../../config');
const { User } = require('./user.model');
const { OtpChallenge } = require('./otp.model');
const {
  ACCOUNT_STATUS,
  OTP_PURPOSE,
  PORTAL,
  JOIN_TYPE_TO_ROLE,
  PENDING_ON_REGISTER_ROLES,
  APP_ROLES,
  VERIFICATION_LEVEL_ON_INVITE_ACTIVATE,
  REJECTION_FIELDS_BY_ROLE,
  EXAM_GOAL_CODES,
} = require('./auth.constants');
const { toPublicUploadPath } = require('./auth.upload');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
} = require('../educator-profile/educator-profile.model');
const {
  attachEducatorSession,
  signUserAccessToken,
} = require('../educator-profile/educator-collab.service');
const { ensureInstituteCode } = require('../educator-profile/institute-code.util');
const { mailService } = require('../../common/mail/mail.service');

const ALL_EXAM_GOAL_CODES = new Set(EXAM_GOAL_CODES);

function roleLabel(role) {
  if (role === APP_ROLES.EDUCATOR) return 'freelancer educator';
  if (role === APP_ROLES.DEFENCE_OFFICER) return 'defence officer';
  if (role === APP_ROLES.INSTITUTE) return 'institute';
  return role;
}

/**
 * Normalizes examGoals from multipart JSON / CSV / array.
 * @param {unknown} input
 * @returns {string[]}
 */
function sanitizeExamGoals(input) {
  let list = input;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      list = Array.isArray(parsed) ? parsed : trimmed.split(',');
    } catch {
      list = trimmed.split(',');
    }
  }

  if (!Array.isArray(list)) {
    return [];
  }

  const unique = new Set();
  for (const code of list) {
    const value = String(code || '')
      .trim()
      .toLowerCase();
    if (ALL_EXAM_GOAL_CODES.has(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

const BLOCKED_LOGIN_STATUSES = new Set([
  ACCOUNT_STATUS.SUSPENDED,
  ACCOUNT_STATUS.BANNED,
  ACCOUNT_STATUS.DELETED,
]);

/**
 * Clear, user-facing copy when login is refused due to account status.
 * @param {string} accountStatus
 * @returns {{ message: string, title: string }}
 */
function getBlockedLoginCopy(accountStatus) {
  if (accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    return {
      title: 'Account suspended',
      message:
        'Your account is temporarily suspended by a platform admin. You cannot sign in or receive OTP until an admin reactivates your account.',
    };
  }

  if (accountStatus === ACCOUNT_STATUS.BANNED) {
    return {
      title: 'Account banned',
      message:
        'Your account has been banned for a policy violation. You cannot sign in until a platform admin restores access.',
    };
  }

  return {
    title: 'Account unavailable',
    message:
      'This account has been removed and can no longer be used to sign in. Register again if you need a new account.',
  };
}

/**
 * Throws a forbidden error for blocked account statuses.
 * @param {string} accountStatus
 */
function assertAccountCanLogin(accountStatus) {
  if (!BLOCKED_LOGIN_STATUSES.has(accountStatus)) {
    return;
  }

  const { title, message } = getBlockedLoginCopy(accountStatus);

  throw new AppError(message, HTTP_STATUS.FORBIDDEN, {
    code: 'ACCOUNT_BLOCKED',
    details: { accountStatus, title },
  });
}

/**
 * Maps a mongoose user document to a safe API shape.
 * @param {import('mongoose').Document} userDoc
 */
function toPublicUser(userDoc) {
  const json = userDoc.toJSON();
  return {
    id: json.id,
    mobileNumber: json.mobileNumber,
    email: json.email,
    fullName: json.fullName,
    role: json.role,
    accountStatus: json.accountStatus,
    isMobileVerified: Boolean(json.isMobileVerified),
    isEmailVerified: Boolean(json.isEmailVerified),
    emailVerifiedAt: json.emailVerifiedAt || undefined,
    portal: json.portal,
    verificationLevel: json.verificationLevel,
    examGoal: json.examGoal || undefined,
    examGoals: Array.isArray(json.examGoals) ? json.examGoals : [],
    profilePhotoPath: json.profilePhotoPath || undefined,
    username: json.username || undefined,
    bio: json.bio || undefined,
    coverPhotoPath: json.coverPhotoPath || undefined,
    city: json.city || undefined,
    education: json.education || undefined,
    languages: Array.isArray(json.languages) ? json.languages : [],
    hobbies: json.hobbies || undefined,
    preferredService: json.preferredService || undefined,
    targetEntry: json.targetEntry || undefined,
    ssbBoard: json.ssbBoard || undefined,
    preparationStage: json.preparationStage || undefined,
    attempts: Number(json.attempts) || 0,
    recommendations: Number(json.recommendations) || 0,
    conferenceOuts: Number(json.conferenceOuts) || 0,
    preferredBranch: json.preferredBranch || undefined,
    medicalStatus: json.medicalStatus || undefined,
    expectedJoining: json.expectedJoining || undefined,
    attemptDate: json.attemptDate || undefined,
    instituteName: json.instituteName || undefined,
    instituteLogoPath: json.instituteLogoPath || undefined,
    officerPhotoPath: json.officerPhotoPath || undefined,
    officerIdDocumentPath: json.officerIdDocumentPath || undefined,
    idDocumentPath: json.idDocumentPath || undefined,
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
    instituteId: json.instituteId ? String(json.instituteId) : undefined,
    invitedByUserId: json.invitedByUserId
      ? String(json.invitedByUserId)
      : undefined,
    permissions: json.permissions || [],
    customRoleId: json.customRoleId ? String(json.customRoleId) : undefined,
    instituteCode: json.instituteCode || undefined,
    activeProfileId: json.activeProfileId
      ? String(json.activeProfileId)
      : undefined,
    createdAt: json.createdAt,
    lastLoginAt: json.lastLoginAt,
  };
}

/**
 * @param {ReturnType<typeof toPublicUser>} user
 */
function buildAuthResult(user) {
  return {
    accessToken: signUserAccessToken(user),
    user,
  };
}

/**
 * Creates / replaces an OTP challenge and returns client-safe payload.
 * @param {{ mobileNumber: string, purpose: string }} input
 */
async function issueOtpChallenge({ mobileNumber, purpose }) {
  const otp = generateOtpCode();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);

  await OtpChallenge.deleteMany({ mobileNumber, purpose });

  await OtpChallenge.create({
    mobileNumber,
    purpose,
    otpHash,
    expiresAt,
  });

  logger.info('OTP issued', {
    mobileNumber,
    purpose,
    // * Exposed until SMS gateway ships — gate via OTP_EXPOSE_IN_RESPONSE.
    ...(config.otp.exposeInResponse ? { debugOtp: otp } : {}),
  });

  return {
    mobileNumber,
    purpose,
    expiresIn: config.otp.ttlSeconds,
    /** Server-only — strip before API response. */
    otp,
    ...(config.otp.exposeInResponse ? { debugOtp: otp } : {}),
  };
}

/**
 * Auth service — user is persisted on register submit; OTP confirms mobile.
 */
class AuthService {
  /**
   * Creates the user immediately, then sends OTP for mobile verification.
   * @param {{
   *   body: Record<string, string>,
   *   files?: Record<string, Express.Multer.File[]>,
   * }} input
   */
  async startRegistration({ body, files = {} }) {
    const joinType = String(body.joinType || '').trim();
    const role = JOIN_TYPE_TO_ROLE[joinType];

    if (!role) {
      throw new AppError(
        'Invalid join type. Use user, institute, defence_officer, or educator.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_JOIN_TYPE' },
      );
    }

    if (
      role === APP_ROLES.EDUCATOR &&
      !config.features.educatorFreelancerRegister
    ) {
      throw new AppError(
        'Freelancer educator registration is temporarily unavailable.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'FEATURE_DISABLED' },
      );
    }

    const mobileNumber = normalizeMobile(body.mobileNumber);
    const email = String(body.email || '')
      .trim()
      .toLowerCase();

    if (!isValidIndianMobile(mobileNumber)) {
      throw new AppError('Enter a valid 10-digit Indian mobile number.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_MOBILE',
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Enter a valid email address.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_EMAIL',
      });
    }

    const existing = await User.findOne({ mobileNumber });
    if (existing) {
      throw new AppError(
        existing.isMobileVerified
          ? 'This mobile number is already registered. Please login instead.'
          : 'Account already created for this mobile. Please login and verify OTP.',
        HTTP_STATUS.CONFLICT,
        { code: 'MOBILE_ALREADY_REGISTERED' },
      );
    }

    /** @type {Record<string, unknown>} */
    const profile = {
      mobileNumber,
      email,
      fullName: '',
      role,
      accountStatus: PENDING_ON_REGISTER_ROLES.has(role)
        ? ACCOUNT_STATUS.PENDING_VERIFICATION
        : ACCOUNT_STATUS.ACTIVE,
      isMobileVerified: false,
      mobileVerifiedAt: null,
      isEmailVerified: false,
      emailVerifiedAt: null,
      portal: PORTAL.APP,
      verificationLevel: 0,
      examGoal: '',
      instituteName: '',
      instituteLogoPath: '',
      officerPhotoPath: '',
      officerIdDocumentPath: '',
      permissions: [],
    };

    if (role === APP_ROLES.USER || role === APP_ROLES.ASPIRANT) {
      const fullName = String(body.fullName || '').trim();
      const examGoal = String(body.examGoal || '').trim();

      if (fullName.length < 2) {
        throw new AppError('Full name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_FULL_NAME',
        });
      }

      if (!examGoal) {
        throw new AppError('Exam goal is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_EXAM_GOAL',
        });
      }

      profile.fullName = fullName;
      profile.examGoal = examGoal;
      // * Persist canonical learner role for new registers.
      profile.role = APP_ROLES.USER;
    }

    if (role === APP_ROLES.INSTITUTE) {
      const instituteName = String(body.instituteName || '').trim();
      const logoFile = files.instituteLogo?.[0];

      if (instituteName.length < 2) {
        throw new AppError('Institute name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_INSTITUTE_NAME',
        });
      }

      if (!logoFile || !logoFile.size) {
        throw new AppError(
          'Institute logo is required.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_INSTITUTE_LOGO' },
        );
      }

      profile.fullName = instituteName;
      profile.instituteName = instituteName;
      profile.instituteLogoPath = toPublicUploadPath(logoFile);
    }

    if (role === APP_ROLES.DEFENCE_OFFICER) {
      const fullName = String(body.fullName || '').trim();
      const idFile = files.officerIdDocument?.[0];

      if (fullName.length < 2) {
        throw new AppError('Full name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_FULL_NAME',
        });
      }

      if (!idFile) {
        throw new AppError(
          'Defence ID document is required.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_OFFICER_ID' },
        );
      }

      profile.fullName = fullName;
      profile.officerPhotoPath = toPublicUploadPath(files.officerPhoto?.[0]);
      profile.officerIdDocumentPath = toPublicUploadPath(idFile);
    }

    if (role === APP_ROLES.EDUCATOR) {
      const fullName = String(body.fullName || '').trim();
      const examGoals = sanitizeExamGoals(body.examGoals);
      const photoFile = files.profilePhoto?.[0];
      const idFile = files.idDocument?.[0];

      if (fullName.length < 2) {
        throw new AppError('Full name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_FULL_NAME',
        });
      }

      if (examGoals.length === 0) {
        throw new AppError(
          'Select at least one exam you prepare students for.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EXAM_GOALS_REQUIRED' },
        );
      }

      if (!photoFile) {
        throw new AppError(
          'Profile photo is required.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_PROFILE_PHOTO' },
        );
      }

      if (!idFile) {
        throw new AppError(
          'ID document is required for educator verification.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_ID_DOCUMENT' },
        );
      }

      const profilePhotoPath = toPublicUploadPath(photoFile);
      const idDocumentPath = toPublicUploadPath(idFile);

      profile.fullName = fullName;
      profile.examGoals = examGoals;
      profile.profilePhotoPath = profilePhotoPath;
      profile.idDocumentPath = idDocumentPath;

      const user = await User.create(profile);

      await EducatorProfile.create({
        userId: user._id,
        type: EDUCATOR_PROFILE_TYPES.FREELANCER,
        instituteId: null,
        status: EDUCATOR_PROFILE_STATUSES.PENDING_VERIFICATION,
        permissions: [],
        displayName: fullName,
        examGoals,
        profilePhotoPath,
        idDocumentPath,
      });

      const otpPayload = await issueOtpChallenge({
        mobileNumber,
        purpose: OTP_PURPOSE.REGISTER,
      });

      const mailResult = await mailService.notifyRegistrationReceived({
        to: email,
        name: fullName,
        roleLabel: roleLabel(role),
        otp: otpPayload.otp,
      });

      const { otp: _otp, ...clientOtp } = otpPayload;

      return {
        ...clientOtp,
        joinType,
        emailSent: Boolean(mailResult?.sent),
        message: mailResult?.sent
          ? 'Account created. Check your email for the OTP.'
          : 'Account created. Verify OTP to continue.',
      };
    }

    await User.create(profile);

    const otpPayload = await issueOtpChallenge({
      mobileNumber,
      purpose: OTP_PURPOSE.REGISTER,
    });

    const mailResult = await mailService.notifyRegistrationReceived({
      to: email,
      name:
        String(profile.fullName || profile.instituteName || '').trim() || 'there',
      roleLabel: roleLabel(role),
      otp: otpPayload.otp,
    });

    const { otp: _otp, ...clientOtp } = otpPayload;

    return {
      ...clientOtp,
      joinType,
      emailSent: Boolean(mailResult?.sent),
      message: mailResult?.sent
        ? 'Account created. Check your email for the OTP.'
        : 'Account created. Verify OTP to continue.',
    };
  }

  /**
   * Sends OTP for login, or resends register verification OTP.
   * @param {{ mobileNumber: string, purpose: string }} input
   */
  async sendOtp({ mobileNumber: rawMobile, purpose }) {
    const mobileNumber = normalizeMobile(rawMobile);

    if (!isValidIndianMobile(mobileNumber)) {
      throw new AppError('Enter a valid 10-digit Indian mobile number.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_MOBILE',
      });
    }

    if (purpose !== OTP_PURPOSE.LOGIN && purpose !== OTP_PURPOSE.REGISTER) {
      throw new AppError('Invalid OTP purpose.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_PURPOSE',
      });
    }

    const user = await User.findOne({ mobileNumber });

    if (!user) {
      throw new AppError(
        purpose === OTP_PURPOSE.LOGIN
          ? 'No account found for this mobile number. Please register first.'
          : 'Account not found. Please submit the registration form again.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'USER_NOT_FOUND' },
      );
    }

    assertAccountCanLogin(user.accountStatus);

    const otpPayload = await issueOtpChallenge({
      mobileNumber,
      purpose,
    });

    let emailSent = false;
    if (user.email) {
      const mailResult = await mailService.notifyOtpCode({
        to: user.email,
        name: user.fullName || user.instituteName || 'there',
        otp: otpPayload.otp,
        purpose,
      });
      emailSent = Boolean(mailResult?.sent);
    }

    const { otp: _otp, ...clientOtp } = otpPayload;
    return {
      ...clientOtp,
      emailSent,
      message: emailSent
        ? 'OTP sent to your registered email.'
        : 'OTP generated. Check the app for the code while SMS is offline.',
    };
  }

  /**
   * Verifies OTP, marks mobile verified, and returns a session.
   * Works for both first-time register OTP and later login OTP.
   * @param {{ mobileNumber: string, otp: string, purpose: string }} input
   */
  async verifyOtp({ mobileNumber: rawMobile, otp, purpose }) {
    const mobileNumber = normalizeMobile(rawMobile);
    const code = String(otp || '').trim();

    if (!isValidIndianMobile(mobileNumber)) {
      throw new AppError('Enter a valid 10-digit Indian mobile number.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_MOBILE',
      });
    }

    if (!/^\d{6}$/.test(code)) {
      throw new AppError('Enter the 6-digit OTP.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_OTP_FORMAT',
      });
    }

    if (purpose !== OTP_PURPOSE.LOGIN && purpose !== OTP_PURPOSE.REGISTER) {
      throw new AppError('Invalid OTP purpose.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_PURPOSE',
      });
    }

    const challenge = await OtpChallenge.findOne({
      mobileNumber,
      purpose,
      consumedAt: null,
    }).sort({ createdAt: -1 });

    if (!challenge) {
      throw new AppError('OTP session not found. Request a new OTP.', HTTP_STATUS.BAD_REQUEST, {
        code: 'OTP_NOT_FOUND',
      });
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppError('OTP has expired. Request a new one.', HTTP_STATUS.BAD_REQUEST, {
        code: 'OTP_EXPIRED',
      });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AppError(
        'Too many invalid attempts. Request a new OTP.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { code: 'OTP_MAX_ATTEMPTS' },
      );
    }

    const isMatch = await verifyOtpHash(code, challenge.otpHash);

    if (!isMatch) {
      challenge.attempts += 1;
      await challenge.save();

      // * Lock on the final failed try so the client can show a clear recovery path.
      if (challenge.attempts >= challenge.maxAttempts) {
        throw new AppError(
          'Too many incorrect attempts. Request a new OTP to continue.',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          {
            code: 'OTP_MAX_ATTEMPTS',
            details: {
              attempts: challenge.attempts,
              maxAttempts: challenge.maxAttempts,
            },
          },
        );
      }

      throw new AppError('Invalid OTP. Please check the code and try again.', HTTP_STATUS.BAD_REQUEST, {
        code: 'OTP_INVALID',
        details: {
          attempts: challenge.attempts,
          maxAttempts: challenge.maxAttempts,
          remainingAttempts: challenge.maxAttempts - challenge.attempts,
        },
      });
    }

    challenge.consumedAt = new Date();
    await challenge.save();

    return this.#completeMobileVerification(mobileNumber);
  }

  /**
   * @param {string} userId
   */
  async getMe(userId) {
    const user = await User.findById(userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    assertAccountCanLogin(user.accountStatus);

    let publicUser = toPublicUser(user);

    // * Team members inherit institute branding from the owner account.
    if (user.instituteId && !publicUser.instituteLogoPath) {
      const owner = await User.findById(user.instituteId).select(
        'instituteLogoPath instituteName',
      );
      if (owner) {
        if (owner.instituteLogoPath) {
          publicUser.instituteLogoPath = owner.instituteLogoPath;
        }
        if (!publicUser.instituteName && owner.instituteName) {
          publicUser.instituteName = owner.instituteName;
        }
      }
    }

    publicUser = await attachEducatorSession(user, publicUser);

    if (user.role === APP_ROLES.INSTITUTE && user.accountStatus === ACCOUNT_STATUS.ACTIVE) {
      const code = await ensureInstituteCode(user);
      publicUser.instituteCode = code;
    }

    return publicUser;
  }

  /**
   * Rejected institute / officer applicants fix flagged fields and re-enter the queue.
   * @param {{
   *   userId: string,
   *   body: Record<string, string>,
   *   files?: Record<string, Express.Multer.File[]>,
   * }} input
   */
  async resubmitApplication({ userId, body, files = {} }) {
    const user = await User.findById(userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    if (
      user.role !== APP_ROLES.INSTITUTE &&
      user.role !== APP_ROLES.DEFENCE_OFFICER &&
      user.role !== APP_ROLES.EDUCATOR
    ) {
      throw new AppError(
        'Only institute, defence officer, and freelancer educator applications can be resubmitted.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'NOT_RESUBMIT_CANDIDATE' },
      );
    }

    if (
      user.role === APP_ROLES.EDUCATOR &&
      user.instituteId
    ) {
      throw new AppError(
        'Institute faculty cannot resubmit via this path.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'NOT_RESUBMIT_CANDIDATE' },
      );
    }

    if (user.accountStatus !== ACCOUNT_STATUS.REJECTED) {
      throw new AppError(
        'Only rejected applications can be fixed and resubmitted.',
        HTTP_STATUS.CONFLICT,
        { code: 'APPLICATION_NOT_REJECTED' },
      );
    }

    const flaggedRaw = Array.isArray(user.rejectedFields)
      ? user.rejectedFields
      : [];
    const roleDefaults = REJECTION_FIELDS_BY_ROLE[user.role] || [];
    const flagged =
      flaggedRaw.length > 0 ? flaggedRaw : [...roleDefaults];

    if (flagged.length === 0) {
      throw new AppError(
        'No fields were flagged for correction. Contact support.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'NO_REJECTED_FIELDS' },
      );
    }

    const flaggedSet = new Set(flagged);

    if (flaggedSet.has('fullName')) {
      const fullName = String(body.fullName || '').trim();
      if (fullName.length < 2) {
        throw new AppError('Full name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_FULL_NAME',
        });
      }
      user.fullName = fullName;
    }

    if (flaggedSet.has('email')) {
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError('Enter a valid email address.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_EMAIL',
        });
      }
      if (email !== String(user.email || '').trim().toLowerCase()) {
        user.email = email;
        user.isEmailVerified = false;
        user.emailVerifiedAt = null;
        const { EmailVerificationChallenge } = require('./email-verification.model');
        await EmailVerificationChallenge.deleteMany({ userId: user._id });
      }
    }

    if (flaggedSet.has('mobileNumber')) {
      const mobileNumber = normalizeMobile(body.mobileNumber);
      if (!isValidIndianMobile(mobileNumber)) {
        throw new AppError(
          'Enter a valid 10-digit Indian mobile number.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_MOBILE' },
        );
      }

      if (mobileNumber !== user.mobileNumber) {
        const taken = await User.findOne({
          mobileNumber,
          _id: { $ne: user._id },
        });
        if (taken) {
          throw new AppError(
            'This mobile number is already registered.',
            HTTP_STATUS.CONFLICT,
            { code: 'MOBILE_ALREADY_REGISTERED' },
          );
        }
        user.mobileNumber = mobileNumber;
      }
    }

    if (flaggedSet.has('instituteName')) {
      const instituteName = String(body.instituteName || '').trim();
      if (instituteName.length < 2) {
        throw new AppError('Institute name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_INSTITUTE_NAME',
        });
      }
      user.instituteName = instituteName;
      user.fullName = instituteName;
    }

    if (flaggedSet.has('instituteLogo')) {
      const logo = files.instituteLogo?.[0];
      if (!logo) {
        throw new AppError(
          'Please upload a new institute logo.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_INSTITUTE_LOGO' },
        );
      }
      user.instituteLogoPath = toPublicUploadPath(logo);
    }

    if (flaggedSet.has('officerPhoto')) {
      const photo = files.officerPhoto?.[0];
      if (!photo) {
        throw new AppError(
          'Please upload a new officer photo.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_OFFICER_PHOTO' },
        );
      }
      user.officerPhotoPath = toPublicUploadPath(photo);
    }

    if (flaggedSet.has('officerIdDocument')) {
      const idDoc = files.officerIdDocument?.[0];
      if (!idDoc) {
        throw new AppError(
          'Please upload a new ID document.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_OFFICER_ID' },
        );
      }
      user.officerIdDocumentPath = toPublicUploadPath(idDoc);
    }

    if (flaggedSet.has('examGoals')) {
      const examGoals = sanitizeExamGoals(body.examGoals);
      if (examGoals.length === 0) {
        throw new AppError(
          'Select at least one exam you prepare students for.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EXAM_GOALS_REQUIRED' },
        );
      }
      user.examGoals = examGoals;
    }

    if (flaggedSet.has('profilePhoto')) {
      const photo = files.profilePhoto?.[0];
      if (!photo) {
        throw new AppError(
          'Please upload a new profile photo.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_PROFILE_PHOTO' },
        );
      }
      user.profilePhotoPath = toPublicUploadPath(photo);
    }

    if (flaggedSet.has('idDocument')) {
      const idDoc = files.idDocument?.[0];
      if (!idDoc) {
        throw new AppError(
          'Please upload a new ID document.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MISSING_ID_DOCUMENT' },
        );
      }
      user.idDocumentPath = toPublicUploadPath(idDoc);
    }

    user.accountStatus = ACCOUNT_STATUS.PENDING_VERIFICATION;
    // * Keep last rejection as context for admin + applicant while pending again.
    user.previousRejectionReason = String(user.rejectionReason || '').trim();
    user.previousRejectedFields = [...flagged];
    user.resubmittedAt = new Date();
    user.resubmissionCount = Math.max(0, Number(user.resubmissionCount) || 0) + 1;
    user.rejectionReason = '';
    user.rejectedFields = [];
    user.reviewedAt = null;
    user.reviewedByAdminId = null;
    await user.save();

    if (user.role === APP_ROLES.EDUCATOR && !user.instituteId) {
      const freelancerProfile = await EducatorProfile.findOne({
        userId: user._id,
        type: EDUCATOR_PROFILE_TYPES.FREELANCER,
        status: { $ne: EDUCATOR_PROFILE_STATUSES.DELETED },
      });

      if (freelancerProfile) {
        if (flaggedSet.has('fullName')) {
          freelancerProfile.displayName = user.fullName;
        }
        if (flaggedSet.has('examGoals')) {
          freelancerProfile.examGoals = [...(user.examGoals || [])];
        }
        if (flaggedSet.has('profilePhoto')) {
          freelancerProfile.profilePhotoPath = user.profilePhotoPath || '';
        }
        if (flaggedSet.has('idDocument')) {
          freelancerProfile.idDocumentPath = user.idDocumentPath || '';
        }
        freelancerProfile.status = EDUCATOR_PROFILE_STATUSES.PENDING_VERIFICATION;
        freelancerProfile.previousRejectionReason = user.previousRejectionReason;
        freelancerProfile.previousRejectedFields = [...user.previousRejectedFields];
        freelancerProfile.resubmittedAt = user.resubmittedAt;
        freelancerProfile.resubmissionCount = user.resubmissionCount;
        freelancerProfile.rejectionReason = '';
        freelancerProfile.rejectedFields = [];
        freelancerProfile.reviewedAt = null;
        freelancerProfile.reviewedByAdminId = null;
        await freelancerProfile.save();
      }
    }

    return toPublicUser(user);
  }

  /**
   * Marks mobile verified and issues JWT for an existing user.
   * @param {string} mobileNumber
   */
  async #completeMobileVerification(mobileNumber) {
    const user = await User.findOne({ mobileNumber });

    if (!user) {
      throw new AppError(
        'No account found for this mobile number.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'USER_NOT_FOUND' },
      );
    }

    assertAccountCanLogin(user.accountStatus);

    if (!user.isMobileVerified) {
      user.isMobileVerified = true;
      user.mobileVerifiedAt = new Date();
    }

    // * Invited institute team activates on first successful OTP login.
    if (user.accountStatus === ACCOUNT_STATUS.INVITED) {
      user.accountStatus = ACCOUNT_STATUS.ACTIVE;
      const inviteLevel = VERIFICATION_LEVEL_ON_INVITE_ACTIVATE[user.role];
      if (
        typeof inviteLevel === 'number' &&
        user.verificationLevel < inviteLevel
      ) {
        user.verificationLevel = inviteLevel;
      }
    }

    user.lastLoginAt = new Date();
    await user.save();

    if (
      user.role === APP_ROLES.EDUCATOR &&
      user.instituteId &&
      user.accountStatus === ACCOUNT_STATUS.ACTIVE
    ) {
      await EducatorProfile.updateOne(
        {
          userId: user._id,
          type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
          instituteId: user.instituteId,
          status: EDUCATOR_PROFILE_STATUSES.INVITED,
        },
        {
          $set: {
            status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
            activatedAt: new Date(),
            permissions: Array.isArray(user.permissions)
              ? [...user.permissions]
              : [],
            joinSource: 'legacy_invite',
          },
        },
      );
    }

    if (user.role === APP_ROLES.INSTITUTE && user.accountStatus === ACCOUNT_STATUS.ACTIVE) {
      await ensureInstituteCode(user);
    }

    let publicUser = toPublicUser(user);

    if (user.instituteId && !publicUser.instituteLogoPath) {
      const owner = await User.findById(user.instituteId).select(
        'instituteLogoPath instituteName',
      );
      if (owner) {
        if (owner.instituteLogoPath) {
          publicUser.instituteLogoPath = owner.instituteLogoPath;
        }
        if (!publicUser.instituteName && owner.instituteName) {
          publicUser.instituteName = owner.instituteName;
        }
      }
    }

    publicUser = await attachEducatorSession(user, publicUser);
    return buildAuthResult(publicUser);
  }
}

module.exports = {
  authService: new AuthService(),
  toPublicUser,
};
