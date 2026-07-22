'use strict';

const { Router } = require('express');
const { authController } = require('./auth.controller');
const { registerUpload } = require('./auth.upload');
const { requireAppAuth } = require('../../common/middleware/requireAppAuth');

/**
 * App-portal auth routes.
 *
 * POST /auth/register      — create user (multipart) → OTP
 * POST /auth/otp/send      — login OTP or register resend
 * POST /auth/otp/verify    — verify mobile → JWT + user
 * GET  /auth/me            — current user (Bearer)
 */
const authRouter = Router();

authRouter.post('/register', registerUpload, authController.register);
authRouter.post('/otp/send', authController.sendOtp);
authRouter.post('/otp/verify', authController.verifyOtp);
authRouter.get('/me', requireAppAuth, authController.me);

module.exports = { authRouter };
