'use strict';

/**
 * Module registry — mount each domain feature here as the project grows.
 *
 * Naming convention per module:
 *   modules/<feature>/
 *     <feature>.model.js
 *     <feature>.repository.js   (optional: isolate DB queries)
 *     <feature>.service.js
 *     <feature>.controller.js
 *     <feature>.routes.js
 *     <feature>.validation.js   (optional: request schemas)
 */

const { healthRouter } = require('./health/health.routes');
const { authRouter } = require('./auth/auth.routes');
const { adminAuthRouter } = require('./admin-auth/admin-auth.routes');
const { adminApprovalsRouter } = require('./admin-approvals/admin-approvals.routes');

module.exports = {
  healthRouter,
  authRouter,
  adminAuthRouter,
  adminApprovalsRouter,
};
