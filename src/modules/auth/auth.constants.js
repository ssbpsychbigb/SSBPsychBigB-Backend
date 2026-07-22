'use strict';

/**
 * Shared auth domain constants for app + admin portals.
 */

const APP_ROLES = Object.freeze({
  ASPIRANT: 'aspirant',
  INSTITUTE: 'institute',
  DEFENCE_OFFICER: 'defence_officer',
});

const ADMIN_ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  PLATFORM_ADMIN: 'platform_admin',
  PLATFORM_MODERATOR: 'platform_moderator',
});

const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING_VERIFICATION: 'pending_verification',
  REJECTED: 'rejected',
  INVITED: 'invited',
  RESTRICTED: 'restricted',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  DELETED: 'deleted',
});

const OTP_PURPOSE = Object.freeze({
  REGISTER: 'register',
  LOGIN: 'login',
});

const PORTAL = Object.freeze({
  APP: 'app',
  ADMIN: 'admin',
});

const JOIN_TYPE_TO_ROLE = Object.freeze({
  aspirant: APP_ROLES.ASPIRANT,
  institute: APP_ROLES.INSTITUTE,
  defence_officer: APP_ROLES.DEFENCE_OFFICER,
});

/** Roles that stay locked until platform admin approval. */
const PENDING_ON_REGISTER_ROLES = new Set([
  APP_ROLES.INSTITUTE,
  APP_ROLES.DEFENCE_OFFICER,
]);

/** Stable permission codes — data-driven baseline (SRS + product). */
const ADMIN_PERMISSIONS = Object.freeze({
  INSTITUTE_VERIFY: 'admin.institute_verify',
  OFFICER_VERIFY: 'admin.officer_verify',
  USERS_READ: 'admin.users.read',
  USERS_MANAGE: 'admin.users.manage',
});

const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ADMIN_ROLES.SUPER_ADMIN]: Object.values(ADMIN_PERMISSIONS),
  [ADMIN_ROLES.PLATFORM_ADMIN]: [
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
    ADMIN_PERMISSIONS.USERS_READ,
  ],
  [ADMIN_ROLES.PLATFORM_MODERATOR]: [ADMIN_PERMISSIONS.USERS_READ],
});

const VERIFICATION_LEVEL_ON_APPROVE = Object.freeze({
  [APP_ROLES.INSTITUTE]: 4,
  [APP_ROLES.DEFENCE_OFFICER]: 3,
});

module.exports = {
  APP_ROLES,
  ADMIN_ROLES,
  ACCOUNT_STATUS,
  OTP_PURPOSE,
  PORTAL,
  JOIN_TYPE_TO_ROLE,
  PENDING_ON_REGISTER_ROLES,
  ADMIN_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  VERIFICATION_LEVEL_ON_APPROVE,
};
