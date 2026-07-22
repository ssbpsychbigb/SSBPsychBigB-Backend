'use strict';

const mongoose = require('mongoose');
const { OTP_PURPOSE } = require('./auth.constants');

/**
 * Short-lived OTP challenge for register / login mobile verification.
 * The User document already exists before register OTP is issued.
 */
const otpChallengeSchema = new mongoose.Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Invalid Indian mobile number'],
      index: true,
    },
    purpose: {
      type: String,
      enum: Object.values(OTP_PURPOSE),
      required: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
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
  },
  { timestamps: true },
);

otpChallengeSchema.index({ mobileNumber: 1, purpose: 1 });
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema);

module.exports = { OtpChallenge };
