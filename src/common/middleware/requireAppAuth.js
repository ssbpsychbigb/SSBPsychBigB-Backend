'use strict';

const { AppError } = require('../errors/AppError');
const { HTTP_STATUS } = require('../constants/httpStatus');
const { verifyAccessToken } = require('../utils/jwt');
const { PORTAL } = require('../../modules/auth/auth.constants');

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

module.exports = { requireAppAuth };
