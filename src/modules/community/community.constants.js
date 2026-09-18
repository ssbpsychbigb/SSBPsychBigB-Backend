'use strict';

/**
 * Community domain constants — Module 5 MVP.
 */

const { APP_ROLES, isLearnerRole } = require('../auth/auth.constants');

/** Roles allowed to create a community in MVP. */
const COMMUNITY_CREATE_ROLES = Object.freeze([
  APP_ROLES.EDUCATOR,
  APP_ROLES.INSTITUTE,
  APP_ROLES.INSTITUTE_ADMIN,
  APP_ROLES.DEFENCE_OFFICER,
]);

/**
 * @param {string | undefined | null} role
 * @returns {boolean}
 */
function canCreateCommunity(role) {
  if (isLearnerRole(role)) return false;
  return COMMUNITY_CREATE_ROLES.includes(String(role || ''));
}

/**
 * @param {string} name
 * @returns {string}
 */
function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

module.exports = {
  COMMUNITY_CREATE_ROLES,
  canCreateCommunity,
  slugifyName,
};
