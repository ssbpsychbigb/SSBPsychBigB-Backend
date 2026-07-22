'use strict';

/**
 * Seeds the default Super Admin for the admin portal.
 * Idempotent — safe to re-run.
 *
 * Usage: yarn seed:admin
 */

require('dotenv').config();

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

    logger.info('Super Admin updated', { loginId, email });
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

    logger.info('Super Admin created', { loginId, email });
  }

  logger.info('Seed complete — use these credentials on the admin portal only', {
    loginId,
    passwordHint: 'from SUPER_ADMIN_PASSWORD (or default ChangeMeNow!123)',
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
