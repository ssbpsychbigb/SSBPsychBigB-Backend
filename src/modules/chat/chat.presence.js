'use strict';

/**
 * In-memory presence — socket connection counts per user (single-node MVP).
 */

/** @type {Map<string, number>} */
const onlineCounts = new Map();

/**
 * @param {string} userId
 * @returns {number}
 */
function connect(userId) {
  const id = String(userId);
  const next = (onlineCounts.get(id) || 0) + 1;
  onlineCounts.set(id, next);
  return next;
}

/**
 * @param {string} userId
 * @returns {number}
 */
function disconnect(userId) {
  const id = String(userId);
  const current = onlineCounts.get(id) || 0;
  if (current <= 1) {
    onlineCounts.delete(id);
    return 0;
  }
  const next = current - 1;
  onlineCounts.set(id, next);
  return next;
}

/**
 * @param {string} userId
 * @returns {boolean}
 */
function isOnline(userId) {
  return (onlineCounts.get(String(userId)) || 0) > 0;
}

/**
 * @param {string[]} userIds
 * @returns {Record<string, boolean>}
 */
function snapshot(userIds) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const id of userIds) {
    out[String(id)] = isOnline(id);
  }
  return out;
}

module.exports = {
  connect,
  disconnect,
  isOnline,
  snapshot,
};
