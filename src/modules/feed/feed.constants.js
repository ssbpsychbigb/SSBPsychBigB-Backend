'use strict';

/**
 * Feed domain constants — Module 4 Phase A–D.
 */

const POST_TYPES = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  POLL: 'poll',
  QUESTION: 'question',
  ACHIEVEMENT: 'achievement',
});

const POST_STATUS = Object.freeze({
  PUBLISHED: 'published',
  DRAFT: 'draft',
  DELETED: 'deleted',
  HIDDEN: 'hidden',
});

const POST_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  FOLLOWERS: 'followers',
  ONLY_ME: 'only_me',
});

const MEDIA_TYPES = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
  AUDIO: 'audio',
});

const POST_CATEGORIES = Object.freeze([
  'psychology',
  'gto',
  'interview',
  'current_affairs',
  'motivation',
  'fitness',
  'defence_news',
  'books',
  'experience',
  'recommendation_story',
  'medical',
  'entry_guidance',
  'leadership',
]);

/** Study Mode keeps educational categories (minimizes entertainment). */
const STUDY_MODE_CATEGORIES = Object.freeze([
  'psychology',
  'gto',
  'interview',
  'current_affairs',
  'fitness',
  'defence_news',
  'books',
  'experience',
  'recommendation_story',
  'medical',
  'entry_guidance',
  'leadership',
]);

const POLL_DURATIONS = Object.freeze({
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
  never: null,
});

const ACHIEVEMENT_KINDS = Object.freeze([
  'screening_in',
  'screening_out',
  'conference_out',
  'recommended',
  'medical',
  'joining',
  'other',
]);

const FEED_LIMITS = Object.freeze({
  MAX_TEXT_LENGTH: 5000,
  MAX_IMAGES: 10,
  MAX_VIDEOS: 1,
  /** MVP video length in seconds (5 minutes). */
  MAX_VIDEO_DURATION_SEC: 300,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
  MAX_COMMENT_LENGTH: 2000,
  MAX_COMMENT_DEPTH: 5,
  MAX_COMMENT_IMAGES: 1,
  MAX_COMMENT_VOICE_SEC: 60,
  REPORT_HIDE_THRESHOLD: 5,
  /** Soft-deleted posts can be restored within this window (days). */
  SOFT_DELETE_RECOVERY_DAYS: 30,
  MAX_POLL_OPTIONS: 6,
  MIN_POLL_OPTIONS: 2,
  MAX_BOOKMARK_FOLDER_LENGTH: 60,
});

/** FEED-004 reaction types (SRS). */
const REACTION_TYPES = Object.freeze([
  'support',
  'like',
  'future',
  'appreciate',
  'helpful',
  'motivating',
  'insightful',
]);

/** Write-path rate limits (per user, sliding window). */
const FEED_RATE_LIMITS = Object.freeze({
  CREATE_POST: { windowMs: 15 * 60 * 1000, max: 20 },
  COMMENT: { windowMs: 15 * 60 * 1000, max: 60 },
  MEDIA_UPLOAD: { windowMs: 15 * 60 * 1000, max: 40 },
  ENGAGE: { windowMs: 60 * 1000, max: 90 },
});

const PIN_LIMITS = Object.freeze({
  user: 1,
  aspirant: 1,
  educator: 5,
  defence_officer: 5,
  institute: 10,
  institute_admin: 10,
});

const REPORT_REASONS = Object.freeze([
  'spam',
  'abuse',
  'misinformation',
  'fake_recommendation',
  'copyright',
  'harassment',
  'other',
]);

const PHASE_A_POST_TYPES = Object.freeze([
  POST_TYPES.TEXT,
  POST_TYPES.IMAGE,
]);

const PHASE_C_POST_TYPES = Object.freeze([
  POST_TYPES.TEXT,
  POST_TYPES.IMAGE,
  POST_TYPES.POLL,
  POST_TYPES.QUESTION,
  POST_TYPES.ACHIEVEMENT,
]);

/** Phase D adds video posts on top of Phase C types. */
const PHASE_D_POST_TYPES = Object.freeze([
  ...PHASE_C_POST_TYPES,
  POST_TYPES.VIDEO,
]);

module.exports = {
  POST_TYPES,
  POST_STATUS,
  POST_VISIBILITY,
  MEDIA_TYPES,
  POST_CATEGORIES,
  STUDY_MODE_CATEGORIES,
  POLL_DURATIONS,
  ACHIEVEMENT_KINDS,
  FEED_LIMITS,
  FEED_RATE_LIMITS,
  REACTION_TYPES,
  PIN_LIMITS,
  REPORT_REASONS,
  PHASE_A_POST_TYPES,
  PHASE_C_POST_TYPES,
  PHASE_D_POST_TYPES,
};
