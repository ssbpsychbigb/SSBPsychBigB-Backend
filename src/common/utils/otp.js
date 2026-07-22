'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');

/**
 * Generates a numeric OTP of the configured length.
 * @returns {string}
 */
function generateOtpCode() {
  const max = 10 ** config.otp.length;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(config.otp.length, '0');
}

/**
 * Hashes an OTP for at-rest storage.
 * @param {string} otp
 * @returns {Promise<string>}
 */
async function hashOtp(otp) {
  return bcrypt.hash(otp, 8);
}

/**
 * Constant-time compare of OTP against stored hash.
 * @param {string} otp
 * @param {string} otpHash
 * @returns {Promise<boolean>}
 */
async function verifyOtpHash(otp, otpHash) {
  return bcrypt.compare(otp, otpHash);
}

/**
 * Normalizes Indian mobile to 10 digits (strips +91 / leading 0).
 * @param {string} raw
 * @returns {string}
 */
function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }

  return digits;
}

/**
 * @param {string} mobile
 * @returns {boolean}
 */
function isValidIndianMobile(mobile) {
  return /^[6-9]\d{9}$/.test(mobile);
}

module.exports = {
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
  normalizeMobile,
  isValidIndianMobile,
};
