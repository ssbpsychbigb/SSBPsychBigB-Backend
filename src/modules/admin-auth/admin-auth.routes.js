'use strict';

const { Router } = require('express');
const { adminAuthController } = require('./admin-auth.controller');
const { requireAdminAuth } = require('../../common/middleware/requireAdminAuth');

/**
 * Admin portal auth routes (password, no OTP).
 *
 * POST /admin/auth/login
 * GET  /admin/auth/me
 */
const adminAuthRouter = Router();

adminAuthRouter.post('/login', adminAuthController.login);
adminAuthRouter.get('/me', requireAdminAuth, adminAuthController.me);

module.exports = { adminAuthRouter };
