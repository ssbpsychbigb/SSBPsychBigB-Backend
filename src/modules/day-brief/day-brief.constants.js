'use strict';

/**
 * Day Brief (24h stories) — constants.
 */

const DAY_BRIEF_TTL_MS = 24 * 60 * 60 * 1000;

const DAY_BRIEF_LIMITS = Object.freeze({
  MAX_CAPTION: 280,
  MAX_ACTIVE_PER_USER: 20,
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  MAX_VIDEO_BYTES: 40 * 1024 * 1024,
  DEFAULT_IMAGE_DURATION_SEC: 6,
  DEFAULT_VIDEO_DURATION_SEC: 12,
  MAX_DURATION_SEC: 60,
});

const DAY_BRIEF_MEDIA_TYPES = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
});

module.exports = {
  DAY_BRIEF_TTL_MS,
  DAY_BRIEF_LIMITS,
  DAY_BRIEF_MEDIA_TYPES,
};
