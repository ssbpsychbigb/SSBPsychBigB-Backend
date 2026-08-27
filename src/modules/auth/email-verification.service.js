'use strict';

const crypto = require('crypto');

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { logger } = require('../../common/utils/logger');
const { generateOtpCode, hashOtp, verifyOtpHash } = require('../../common/utils/otp');
const { mailService } = require('../../common/mail/mail.service');
const { verifyEmailUrl } = require('../../common/mail/mail.templates');
const config = require('../../config');
const { ACCOUNT_STATUS } = require('./auth.constants');
const { User } = require('./user.model');
const { EmailVerificationChallenge } = require('./email-verification.model');

/**
 * Masks an email for UI copy (r***@gmail.com).
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  const value = String(email || '')
    .trim()
    .toLowerCase();
  const at = value.indexOf('@');

  if (at < 1 || at === value.length - 1) {
    return '***';
  }

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * @param {import('mongoose').Document} user
 */
async function markUserEmailVerified(user) {
  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();
  await user.save();
}

/**
 * Email verification — separate from login OTP.
 */
class EmailVerificationService {
  /**
   * Issues a fresh OTP + magic link for the signed-in user's current email.
   * @param {string} userId
   */
  async sendVerification(userId) {
    const user = await User.findById(userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    const email = String(user.email || '')
      .trim()
      .toLowerCase();

    if (!email) {
      throw new AppError('Add an email address before verifying.', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMAIL_MISSING',
      });
    }

    if (user.isEmailVerified) {
      const { authService } = require('./auth.service');
      return {
        alreadyVerified: true,
        emailSent: false,
        maskedEmail: maskEmail(email),
        user: await authService.getMe(String(user._id)),
      };
    }

    const cooldownMs = config.emailVerify.resendCooldownSeconds * 1000;
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentSends = await EmailVerificationChallenge.countDocuments({
      userId: user._id,
      lastSentAt: { $gte: hourAgo },
    });

    if (recentSends >= config.emailVerify.maxSendsPerHour) {
      throw new AppError(
        'Too many verification emails. Try again in an hour.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { code: 'EMAIL_VERIFY_RATE_LIMIT' },
      );
    }

    const latest = await EmailVerificationChallenge.findOne({
      userId: user._id,
      consumedAt: null,
    }).sort({ lastSentAt: -1 });

    if (
      latest &&
      latest.lastSentAt &&
      Date.now() - latest.lastSentAt.getTime() < cooldownMs
    ) {
      const retryAfter = Math.ceil(
        (cooldownMs - (Date.now() - latest.lastSentAt.getTime())) / 1000,
      );

      throw new AppError(
        `Please wait ${retryAfter} seconds before requesting another email.`,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        {
          code: 'EMAIL_VERIFY_COOLDOWN',
          details: { retryAfter },
        },
      );
    }

    const otp = generateOtpCode();
    const token = crypto.randomBytes(32).toString('hex');
    const otpHash = await hashOtp(otp);
    const tokenHash = hashToken(token);
    const now = new Date();
    const otpExpiresAt = new Date(
      now.getTime() + config.emailVerify.otpTtlSeconds * 1000,
    );
    const tokenExpiresAt = new Date(
      now.getTime() + config.emailVerify.tokenTtlSeconds * 1000,
    );

    await EmailVerificationChallenge.deleteMany({
      userId: user._id,
      consumedAt: null,
    });

    await EmailVerificationChallenge.create({
      userId: user._id,
      email,
      otpHash,
      tokenHash,
      otpExpiresAt,
      tokenExpiresAt,
      maxAttempts: config.emailVerify.maxOtpAttempts,
      lastSentAt: now,
    });

    const verifyUrl = verifyEmailUrl(token);
    void mailService
      .notifyEmailVerification({
        to: email,
        name: user.fullName || user.instituteName || 'there',
        otp,
        verifyUrl,
      })
      .catch((error) => {
        logger.error('Email verification send failed', {
          userId: String(user._id),
          error: error instanceof Error ? error.message : String(error),
        });
      });

    logger.info('Email verification issued', {
      userId: String(user._id),
      emailSent: true,
      ...(config.otp.exposeInResponse ? { debugOtp: otp } : {}),
    });

    return {
      alreadyVerified: false,
      emailSent: true,
      maskedEmail: maskEmail(email),
      expiresIn: config.emailVerify.otpTtlSeconds,
      cooldownSeconds: config.emailVerify.resendCooldownSeconds,
      ...(config.otp.exposeInResponse
        ? { debugOtp: otp, debugVerifyUrl: verifyUrl }
        : {}),
    };
  }

  /**
   * Confirms the 6-digit code for the signed-in user.
   * @param {{ userId: string, otp: string }} input
   */
  async verifyOtp({ userId, otp }) {
    const code = String(otp || '').trim();

    if (!/^\d{6}$/.test(code)) {
      throw new AppError('Enter the 6-digit code from your email.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_OTP_FORMAT',
      });
    }

    const user = await User.findById(userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    if (user.isEmailVerified) {
      const { authService } = require('./auth.service');
      return {
        alreadyVerified: true,
        user: await authService.getMe(String(user._id)),
      };
    }

    const challenge = await EmailVerificationChallenge.findOne({
      userId: user._id,
      consumedAt: null,
    }).sort({ createdAt: -1 });

    if (!challenge) {
      throw new AppError(
        'No verification code found. Request a new email.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMAIL_VERIFY_NOT_FOUND' },
      );
    }

    if (challenge.otpExpiresAt.getTime() < Date.now()) {
      throw new AppError(
        'This code has expired. Request a new email.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMAIL_VERIFY_OTP_EXPIRED' },
      );
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AppError(
        'Too many incorrect attempts. Request a new email.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { code: 'EMAIL_VERIFY_MAX_ATTEMPTS' },
      );
    }

    const isMatch = await verifyOtpHash(code, challenge.otpHash);

    if (!isMatch) {
      challenge.attempts += 1;
      await challenge.save();

      if (challenge.attempts >= challenge.maxAttempts) {
        throw new AppError(
          'Too many incorrect attempts. Request a new email.',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          { code: 'EMAIL_VERIFY_MAX_ATTEMPTS' },
        );
      }

      throw new AppError('Invalid code. Check the email and try again.', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMAIL_VERIFY_OTP_INVALID',
        details: {
          attempts: challenge.attempts,
          maxAttempts: challenge.maxAttempts,
          remainingAttempts: challenge.maxAttempts - challenge.attempts,
        },
      });
    }

    challenge.consumedAt = new Date();
    await challenge.save();
    await markUserEmailVerified(user);

    const { authService } = require('./auth.service');
    return {
      alreadyVerified: false,
      user: await authService.getMe(String(user._id)),
    };
  }

  /**
   * Public token redeem from the verify-email landing page.
   * @param {string} rawToken
   */
  async verifyToken(rawToken) {
    const token = String(rawToken || '').trim();

    if (!token || token.length < 16) {
      throw new AppError('This verification link is invalid.', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMAIL_VERIFY_TOKEN_INVALID',
      });
    }

    const challenge = await EmailVerificationChallenge.findOne({
      tokenHash: hashToken(token),
    });

    if (!challenge) {
      throw new AppError(
        'This verification link is invalid or has already been used.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMAIL_VERIFY_TOKEN_INVALID' },
      );
    }

    const user = await User.findById(challenge.userId);

    if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw new AppError('Account not found for this link.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    if (user.isEmailVerified) {
      return {
        verified: true,
        alreadyVerified: true,
        userId: String(user._id),
        maskedEmail: maskEmail(user.email),
      };
    }

    if (challenge.consumedAt) {
      throw new AppError(
        'This verification link has already been used.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMAIL_VERIFY_TOKEN_USED' },
      );
    }

    if (challenge.tokenExpiresAt.getTime() < Date.now()) {
      throw new AppError(
        'This verification link has expired. Sign in and request a new email.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMAIL_VERIFY_TOKEN_EXPIRED' },
      );
    }

    challenge.consumedAt = new Date();
    await challenge.save();
    await markUserEmailVerified(user);

    return {
      verified: true,
      alreadyVerified: false,
      userId: String(user._id),
      maskedEmail: maskEmail(user.email),
    };
  }
}

module.exports = {
  emailVerificationService: new EmailVerificationService(),
  maskEmail,
};
