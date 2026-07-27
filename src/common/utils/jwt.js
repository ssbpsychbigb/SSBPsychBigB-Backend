'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');

/**
 * Issues a portal-scoped access token.
 * @param {{
 *   id: string,
 *   role: string,
 *   portal: string,
 *   accountStatus: string,
 *   mobileNumber?: string,
 *   loginId?: string,
 *   activeProfileId?: string,
 * }} subject
 * @returns {string}
 */
function signAccessToken(subject) {
  /** @type {Record<string, unknown>} */
  const payload = {
    sub: subject.id,
    role: subject.role,
    portal: subject.portal,
    accountStatus: subject.accountStatus,
  };

  if (subject.mobileNumber) {
    payload.mobileNumber = subject.mobileNumber;
  }

  if (subject.loginId) {
    payload.loginId = subject.loginId;
  }

  if (subject.activeProfileId) {
    payload.activeProfileId = subject.activeProfileId;
  }

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * Verifies a Bearer JWT and returns the payload.
 * @param {string} token
 * @returns {import('jsonwebtoken').JwtPayload}
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    throw new AppError('Invalid or expired token', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_TOKEN',
    });
  }
}

module.exports = { signAccessToken, verifyAccessToken };
