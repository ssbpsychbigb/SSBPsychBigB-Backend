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
 * Fast HMAC digest for short-lived OTPs (avoids bcrypt CPU on Render).
 * @param {string} otp
 * @returns {string}
 */
function hmacOtp(otp) {
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`otp:${String(otp)}`)
    .digest('hex');
}

/**
 * Hashes an OTP for at-rest storage.
 * @param {string} otp
 * @returns {Promise<string>}
 */
async function hashOtp(otp) {
  return hmacOtp(otp);
}

/**
 * Constant-time compare of OTP against stored hash.
 * Supports legacy bcrypt hashes still in TTL after deploy.
 * @param {string} otp
 * @param {string} otpHash
 * @returns {Promise<boolean>}
 */
async function verifyOtpHash(otp, otpHash) {
  const stored = String(otpHash || '');
  if (stored.startsWith('$2')) {
    return bcrypt.compare(otp, stored);
  }

  const expected = hmacOtp(otp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
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
