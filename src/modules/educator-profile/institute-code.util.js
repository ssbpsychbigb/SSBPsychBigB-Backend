'use strict';

const { User } = require('../auth/user.model');
const { APP_ROLES } = require('../auth/auth.constants');

/**
 * Generates a unique public institute code (e.g. SSBP7K2A).
 * @returns {Promise<string>}
 */
async function generateUniqueInstituteCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `SSB${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await User.exists({
      role: APP_ROLES.INSTITUTE,
      instituteCode: code,
    });
    if (!taken) {
      return code;
    }
  }

  return `SSB${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Ensures an institute owner has a public instituteCode.
 * @param {import('mongoose').Document} instituteUser
 * @returns {Promise<string>}
 */
async function ensureInstituteCode(instituteUser) {
  const existing = String(instituteUser.instituteCode || '')
    .trim()
    .toUpperCase();
  if (existing) {
    return existing;
  }

  const code = await generateUniqueInstituteCode();
  instituteUser.instituteCode = code;
  await instituteUser.save();
  return code;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeInstituteCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  generateUniqueInstituteCode,
  ensureInstituteCode,
  normalizeInstituteCode,
};
