'use strict';

/**
 * Backfills EducatorProfile rows for existing institute faculty (role=educator + instituteId).
 * Idempotent — skips users that already have a matching institute profile.
 *
 * Usage (from Backend folder): yarn migrate:educator-profiles
 */

const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { User } = require('../src/modules/auth/user.model');
const {
  APP_ROLES,
  ACCOUNT_STATUS,
} = require('../src/modules/auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
} = require('../src/modules/educator-profile/educator-profile.model');
const { logger } = require('../src/common/utils/logger');

/**
 * Maps User.accountStatus onto EducatorProfile.status for faculty.
 * @param {string} accountStatus
 */
function mapFacultyStatus(accountStatus) {
  if (accountStatus === ACCOUNT_STATUS.INVITED) {
    return EDUCATOR_PROFILE_STATUSES.INVITED;
  }
  if (accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    return EDUCATOR_PROFILE_STATUSES.SUSPENDED;
  }
  if (accountStatus === ACCOUNT_STATUS.DELETED) {
    return EDUCATOR_PROFILE_STATUSES.DELETED;
  }
  return EDUCATOR_PROFILE_STATUSES.ACTIVE;
}

async function migrateInstituteEducators() {
  await connectDatabase();

  const faculty = await User.find({
    role: APP_ROLES.EDUCATOR,
    instituteId: { $ne: null },
  });

  let created = 0;
  let skipped = 0;

  for (const member of faculty) {
    const existing = await EducatorProfile.findOne({
      userId: member._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId: member.instituteId,
      status: { $ne: EDUCATOR_PROFILE_STATUSES.DELETED },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await EducatorProfile.create({
      userId: member._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId: member.instituteId,
      status: mapFacultyStatus(member.accountStatus),
      permissions: Array.isArray(member.permissions) ? [...member.permissions] : [],
      displayName: member.fullName || '',
      examGoals: Array.isArray(member.examGoals) ? [...member.examGoals] : [],
      profilePhotoPath: member.profilePhotoPath || '',
      invitedByUserId: member.invitedByUserId || null,
      activatedAt:
        member.accountStatus === ACCOUNT_STATUS.ACTIVE
          ? member.mobileVerifiedAt || member.updatedAt || new Date()
          : null,
    });
    created += 1;
  }

  logger.info('Educator profile migration complete', {
    scanned: faculty.length,
    created,
    skipped,
  });

  await disconnectDatabase();
}

migrateInstituteEducators().catch(async (error) => {
  logger.error('Educator profile migration failed', {
    message: error.message,
    stack: error.stack,
  });
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
