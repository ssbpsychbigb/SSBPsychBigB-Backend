'use strict';

const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');
const { verifyAccessToken } = require('../utils/jwt');
const { PORTAL } = require('../../modules/auth/auth.constants');

/**
 * Requires a valid admin-portal Bearer JWT.
 * Attaches decoded claims to `req.auth`.
 *
 * @type {import('express').RequestHandler}
 */
function requireAdminAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(
      new AppError('Admin authentication required', HTTP_STATUS.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
      }),
    );
  }

  const payload = verifyAccessToken(token);

  if (payload.portal !== PORTAL.ADMIN) {
    return next(
      new AppError('Invalid portal token for admin API', HTTP_STATUS.FORBIDDEN, {
        code: 'WRONG_PORTAL',
      }),
    );
  }

  req.auth = payload;
  return next();
}

/**
 * Requires one of the listed admin permission codes (or super_admin via grants).
 *
 * @param {...string} permissionCodes
 * @returns {import('express').RequestHandler}
 */
function requireAdminPermission(...permissionCodes) {
  return async (req, _res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError('Admin authentication required', HTTP_STATUS.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
        });
      }

      const { AdminUser } = require('../../modules/admin-auth/admin-user.model');
      const { ADMIN_ROLES, ROLE_DEFAULT_PERMISSIONS } = require('../../modules/auth/auth.constants');

      const admin = await AdminUser.findById(req.auth.sub);
      if (!admin) {
        throw new AppError('Admin not found', HTTP_STATUS.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
        });
      }

      const granted = new Set([
        ...(ROLE_DEFAULT_PERMISSIONS[admin.role] || []),
        ...(admin.permissions || []),
      ]);

      // * Super Admin always passes permission gates.
      if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
        req.admin = admin;
        return next();
      }

      const allowed = permissionCodes.some((code) => granted.has(code));
      if (!allowed) {
        throw new AppError('Insufficient admin permissions', HTTP_STATUS.FORBIDDEN, {
          code: 'FORBIDDEN',
          details: { required: permissionCodes },
        });
      }

      req.admin = admin;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireAdminAuth, requireAdminPermission };
