'use strict';

const mongoose = require('mongoose');

/**
 * One active email-verification challenge per user (OTP + clickable token).
 * Login OTP stays on OtpChallenge — this layer only proves inbox ownership.
 */
const emailVerificationChallengeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    otpExpiresAt: {
      type: Date,
      required: true,
    },
    tokenExpiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    lastSentAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

emailVerificationChallengeSchema.index({ userId: 1, consumedAt: 1 });
emailVerificationChallengeSchema.index(
  { tokenExpiresAt: 1 },
  { expireAfterSeconds: 0 },
);

const EmailVerificationChallenge = mongoose.model(
  'EmailVerificationChallenge',
  emailVerificationChallengeSchema,
);

module.exports = { EmailVerificationChallenge };
