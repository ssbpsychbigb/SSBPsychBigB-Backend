'use strict';

const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');
const { verifyAccessToken } = require('../utils/jwt');
const {
  PORTAL,
  ACCOUNT_STATUS,
  APP_ROLES,
} = require('../../modules/auth/auth.constants');

/**
 * Requires a valid app-portal Bearer JWT.
 * Attaches decoded claims to `req.auth`.
 *
 * @type {import('express').RequestHandler}
 */
function requireAppAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(
      new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
      }),
    );
  }

  const payload = verifyAccessToken(token);

  if (payload.portal && payload.portal !== PORTAL.APP) {
    return next(
      new AppError('Invalid portal token for this API', HTTP_STATUS.FORBIDDEN, {
        code: 'WRONG_PORTAL',
      }),
    );
  }

  req.auth = payload;
  return next();
}

/**
 * Loads the authenticated app User onto `req.appUser`.
 * Optionally requires active account status and/or specific roles.
 *
 * @param {{
 *   requireActive?: boolean,
 *   roles?: string[],
 * }} [options]
 * @returns {import('express').RequestHandler}
 */
function requireAppUser(options = {}) {
  const requireActive = options.requireActive !== false;
  const roles = Array.isArray(options.roles) ? options.roles : null;

  return async (req, _res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
        });
      }

      const { User } = require('../../modules/auth/user.model');
      const user = await User.findById(req.auth.sub);

      if (!user || user.accountStatus === ACCOUNT_STATUS.DELETED) {
        throw new AppError('User not found.', HTTP_STATUS.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
        });
      }

      if (
        user.accountStatus === ACCOUNT_STATUS.SUSPENDED ||
        user.accountStatus === ACCOUNT_STATUS.BANNED
      ) {
        throw new AppError(
          'Your account cannot access this resource.',
          HTTP_STATUS.FORBIDDEN,
          { code: 'ACCOUNT_BLOCKED' },
        );
      }

      if (requireActive && user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
        throw new AppError(
          'Your account must be active to use this feature.',
          HTTP_STATUS.FORBIDDEN,
          { code: 'ACCOUNT_NOT_ACTIVE' },
        );
      }

      if (roles && !roles.includes(user.role)) {
        throw new AppError(
          'You do not have access to the institute panel.',
          HTTP_STATUS.FORBIDDEN,
          { code: 'WRONG_ROLE' },
        );
      }

      req.appUser = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Attaches `req.auth` when a valid app Bearer token is present.
 * Invalid / missing tokens do not fail the request (guest-friendly reads).
 *
 * @type {import('express').RequestHandler}
 */
function optionalAppAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    if (!payload.portal || payload.portal === PORTAL.APP) {
      req.auth = payload;
    }
  } catch {
    // * Guest read continues without auth.
  }

  return next();
}

module.exports = {
  requireAppAuth,
  requireAppUser,
  optionalAppAuth,
  APP_ROLES,
};
