'use strict';

/**
 * Seeds the default Super Admin for the admin portal.
 * Idempotent — safe to re-run (updates password/profile from .env).
 *
 * Reads from Backend `.env`:
 *   SUPER_ADMIN_LOGIN_ID
 *   SUPER_ADMIN_PASSWORD
 *   SUPER_ADMIN_EMAIL
 *   SUPER_ADMIN_NAME
 *
 * Usage (from Backend folder): yarn seed:admin
 */

const path = require('path');
const dotenv = require('dotenv');

// * Always load Backend/.env regardless of shell cwd quirks.
const envPath = path.resolve(__dirname, '../.env');
const envResult = dotenv.config({ path: envPath });

const bcrypt = require('bcryptjs');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { AdminUser } = require('../src/modules/admin-auth/admin-user.model');
const {
  ADMIN_ROLES,
  ACCOUNT_STATUS,
  PORTAL,
  ROLE_DEFAULT_PERMISSIONS,
} = require('../src/modules/auth/auth.constants');
const { logger } = require('../src/common/utils/logger');

async function seedSuperAdmin() {
  if (envResult.error) {
    logger.warn('Could not load .env — falling back to script defaults', {
      envPath,
      message: envResult.error.message,
    });
  } else {
    logger.info('Loaded .env for seed', { envPath });
  }

  const loginIdFromEnv = Boolean(process.env.SUPER_ADMIN_LOGIN_ID);
  const passwordFromEnv = Boolean(process.env.SUPER_ADMIN_PASSWORD);
  const emailFromEnv = Boolean(process.env.SUPER_ADMIN_EMAIL);
  const nameFromEnv = Boolean(process.env.SUPER_ADMIN_NAME);

  const loginId = (
    process.env.SUPER_ADMIN_LOGIN_ID || 'superadmin'
  )
    .trim()
    .toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMeNow!123';
  const email = (
    process.env.SUPER_ADMIN_EMAIL || 'superadmin@bigb.local'
  )
    .trim()
    .toLowerCase();
  const fullName = process.env.SUPER_ADMIN_NAME || 'BIGB Super Admin';

  logger.info('Seed credentials source', {
    loginId,
    email,
    fullName,
    loginIdFromEnv,
    passwordFromEnv,
    emailFromEnv,
    nameFromEnv,
    passwordLength: password.length,
  });

  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters');
  }

  await connectDatabase();

  const passwordHash = await bcrypt.hash(password, 12);
  const permissions = [...ROLE_DEFAULT_PERMISSIONS[ADMIN_ROLES.SUPER_ADMIN]];

  const existing = await AdminUser.findOne({ loginId }).select('+passwordHash');

  if (existing) {
    existing.email = email;
    existing.fullName = fullName;
    existing.role = ADMIN_ROLES.SUPER_ADMIN;
    existing.accountStatus = ACCOUNT_STATUS.ACTIVE;
    existing.portal = PORTAL.ADMIN;
    existing.permissions = permissions;
    existing.passwordHash = passwordHash;
    await existing.save();

    logger.info('Super Admin updated from seed values', { loginId, email });
  } else {
    await AdminUser.create({
      loginId,
      passwordHash,
      email,
      fullName,
      role: ADMIN_ROLES.SUPER_ADMIN,
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      portal: PORTAL.ADMIN,
      permissions,
    });

    logger.info('Super Admin created from seed values', { loginId, email });
  }

  logger.info('Seed complete — sign in on admin portal with Login ID + .env password', {
    loginId,
    passwordFromEnv,
    tip: passwordFromEnv
      ? 'Password taken from SUPER_ADMIN_PASSWORD in .env'
      : 'Password used script default ChangeMeNow!123 — set SUPER_ADMIN_PASSWORD in .env and re-run',
  });
}

seedSuperAdmin()
  .catch((error) => {
    logger.error('Super Admin seed failed', {
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
