'use strict';

/**
 * Institute collaboration HR rules — leave (temporary) vs resign (permanent).
 */

const DEFAULT_RESIGN_NOTICE_DAYS = 14;
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const MAX_LEAVE_DAYS = 90;

/** Membership still open — blocks re-hire / duplicate join. */
const OPEN_COLLAB_STATUSES = Object.freeze([
  'invited',
  'active',
  'leave_pending',
  'on_leave',
  'resign_pending',
  'notice_period',
  'suspended',
]);

/** Educator may still enter this institute context. */
const ENTERABLE_COLLAB_STATUSES = Object.freeze([
  'active',
  'leave_pending',
  'on_leave',
  'resign_pending',
  'notice_period',
]);

/**
 * @param {string} reason
 * @returns {string}
 */
function normalizeReason(reason) {
  return String(reason || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} reason
 * @param {string} label
 * @returns {string}
 */
function requireReason(reason, label = 'Reason') {
  const text = normalizeReason(reason);
  if (text.length < MIN_REASON_LENGTH) {
    const err = new Error(
      `${label} must be at least ${MIN_REASON_LENGTH} characters.`,
    );
    err.code = 'REASON_REQUIRED';
    throw err;
  }
  if (text.length > MAX_REASON_LENGTH) {
    const err = new Error(
      `${label} must be at most ${MAX_REASON_LENGTH} characters.`,
    );
    err.code = 'REASON_TOO_LONG';
    throw err;
  }
  return text;
}

/**
 * @param {Date} from
 * @param {number} days
 * @returns {Date}
 */
function addDays(from, days) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * @param {string|Date} value
 * @param {string} label
 * @returns {Date}
 */
function parseDateOnly(value, label) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error(`${label} must be a valid date (YYYY-MM-DD).`);
    err.code = 'INVALID_DATE';
    throw err;
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${label} must be a valid date (YYYY-MM-DD).`);
    err.code = 'INVALID_DATE';
    throw err;
  }
  return date;
}

module.exports = {
  DEFAULT_RESIGN_NOTICE_DAYS,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  MAX_LEAVE_DAYS,
  OPEN_COLLAB_STATUSES,
  ENTERABLE_COLLAB_STATUSES,
  normalizeReason,
  requireReason,
  addDays,
  parseDateOnly,
};
