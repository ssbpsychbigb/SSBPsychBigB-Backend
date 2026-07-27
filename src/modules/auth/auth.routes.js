'use strict';

const { Router } = require('express');
const { authController } = require('./auth.controller');
const { registerUpload } = require('./auth.upload');
const { requireAppAuth } = require('../../common/middleware/requireAppAuth');

/**
 * App-portal auth routes.
 *
 * POST /auth/register                — create user (multipart) → OTP
 * POST /auth/otp/send                — login OTP or register resend
 * POST /auth/otp/verify              — verify mobile → JWT + user
 * GET  /auth/me                      — current user (Bearer)
 * POST /auth/application/resubmit    — fix rejected application fields
 */
const authRouter = Router();

authRouter.post('/register', registerUpload, authController.register);
authRouter.post('/otp/send', authController.sendOtp);
authRouter.post('/otp/verify', authController.verifyOtp);
authRouter.get('/me', requireAppAuth, authController.me);
authRouter.post(
  '/application/resubmit',
  requireAppAuth,
  registerUpload,
  authController.resubmitApplication,
);
authRouter.post(
  '/educator/join-requests',
  requireAppAuth,
  authController.requestJoin,
);
authRouter.get(
  '/educator/institutes',
  requireAppAuth,
  authController.listInstitutes,
);
authRouter.post(
  '/educator/collaborations/:profileId/accept',
  requireAppAuth,
  authController.acceptHire,
);
authRouter.post(
  '/educator/collaborations/:profileId/decline',
  requireAppAuth,
  authController.declineCollab,
);
authRouter.post(
  '/educator/collaborations/:profileId/leave',
  requireAppAuth,
  authController.requestLeave,
);
authRouter.post(
  '/educator/collaborations/:profileId/leave/cancel',
  requireAppAuth,
  authController.cancelLeave,
);
authRouter.post(
  '/educator/collaborations/:profileId/resign',
  requireAppAuth,
  authController.requestResign,
);
authRouter.post(
  '/educator/collaborations/:profileId/resign/cancel',
  requireAppAuth,
  authController.cancelResign,
);
authRouter.post(
  '/profiles/:profileId/switch',
  requireAppAuth,
  authController.switchProfile,
);

module.exports = { authRouter };
