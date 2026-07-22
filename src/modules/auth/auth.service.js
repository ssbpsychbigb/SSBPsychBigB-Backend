'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { logger } = require('../../common/utils/logger');
const { signAccessToken } = require('../../common/utils/jwt');
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
} = require('./auth.constants');
const { toPublicUploadPath } = require('./auth.upload');

const BLOCKED_LOGIN_STATUSES = new Set([
  ACCOUNT_STATUS.SUSPENDED,
  ACCOUNT_STATUS.BANNED,
  ACCOUNT_STATUS.DELETED,
]);

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
    portal: json.portal,
    verificationLevel: json.verificationLevel,
    examGoal: json.examGoal || undefined,
    instituteName: json.instituteName || undefined,
    instituteLogoPath: json.instituteLogoPath || undefined,
    officerPhotoPath: json.officerPhotoPath || undefined,
    officerIdDocumentPath: json.officerIdDocumentPath || undefined,
    rejectionReason: json.rejectionReason || undefined,
    permissions: json.permissions || [],
    createdAt: json.createdAt,
    lastLoginAt: json.lastLoginAt,
  };
}

/**
 * @param {ReturnType<typeof toPublicUser>} user
 */
function buildAuthResult(user) {
  return {
    accessToken: signAccessToken(user),
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
    // * Dev-only visibility — production SMS gateway will replace this.
    ...(config.isProduction ? {} : { debugOtp: otp }),
  });

  return {
    mobileNumber,
    purpose,
    expiresIn: config.otp.ttlSeconds,
    ...(config.isProduction ? {} : { debugOtp: otp }),
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
        'Invalid join type. Use aspirant, institute, or defence_officer.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_JOIN_TYPE' },
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
      portal: PORTAL.APP,
      verificationLevel: 0,
      examGoal: '',
      instituteName: '',
      instituteLogoPath: '',
      officerPhotoPath: '',
      officerIdDocumentPath: '',
      permissions: [],
    };

    if (role === APP_ROLES.ASPIRANT) {
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
    }

    if (role === APP_ROLES.INSTITUTE) {
      const instituteName = String(body.instituteName || '').trim();
      if (instituteName.length < 2) {
        throw new AppError('Institute name is required.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_INSTITUTE_NAME',
        });
      }

      profile.fullName = instituteName;
      profile.instituteName = instituteName;
      profile.instituteLogoPath = toPublicUploadPath(files.instituteLogo?.[0]);
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

    await User.create(profile);

    const otpPayload = await issueOtpChallenge({
      mobileNumber,
      purpose: OTP_PURPOSE.REGISTER,
    });

    return {
      ...otpPayload,
      joinType,
      message: 'Account created. Verify OTP to continue.',
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

    if (BLOCKED_LOGIN_STATUSES.has(user.accountStatus)) {
      throw new AppError(
        'This account cannot sign in right now. Contact support.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'ACCOUNT_BLOCKED', details: { accountStatus: user.accountStatus } },
      );
    }

    return issueOtpChallenge({
      mobileNumber,
      purpose,
    });
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

    if (BLOCKED_LOGIN_STATUSES.has(user.accountStatus)) {
      throw new AppError(
        'This account cannot sign in right now. Contact support.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'ACCOUNT_BLOCKED' },
      );
    }

    if (!user.isMobileVerified) {
      user.isMobileVerified = true;
      user.mobileVerifiedAt = new Date();
    }

    user.lastLoginAt = new Date();
    await user.save();

    return buildAuthResult(toPublicUser(user));
  }
}

module.exports = { authService: new AuthService() };
