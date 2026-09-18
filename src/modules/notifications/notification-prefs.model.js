'use strict';

const mongoose = require('mongoose');

const DEFAULT_CATEGORIES = Object.freeze({
  social: true,
  network: true,
  mentions: true,
  learning: true,
  alerts: true,
  community: true,
});

/**
 * Per-user notification preferences (Wave 5).
 */
const notificationPrefsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    categories: {
      social: { type: Boolean, default: true },
      network: { type: Boolean, default: true },
      mentions: { type: Boolean, default: true },
      learning: { type: Boolean, default: true },
      alerts: { type: Boolean, default: true },
      community: { type: Boolean, default: true },
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      /** "HH:mm" 24h local to timezone */
      start: { type: String, default: '22:00' },
      end: { type: String, default: '07:00' },
      timezone: { type: String, default: 'Asia/Kolkata' },
    },
    pushEnabled: {
      type: Boolean,
      default: false,
    },
    /** Chat read receipts — when false, do not publish peer-visible reads. */
    readReceiptsEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, collection: 'notification_prefs' },
);

const NotificationPrefs = mongoose.model(
  'NotificationPrefs',
  notificationPrefsSchema,
);

module.exports = {
  NotificationPrefs,
  DEFAULT_CATEGORIES,
};
