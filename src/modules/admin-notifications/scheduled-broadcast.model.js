'use strict';

const mongoose = require('mongoose');

const BROADCAST_STATUSES = Object.freeze([
  'pending',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);

const BROADCAST_AUDIENCES = Object.freeze(['all', 'role', 'exam']);

const scheduledBroadcastSchema = new mongoose.Schema(
  {
    headline: {
      type: String,
      default: 'Announcement from BIGB',
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    href: {
      type: String,
      default: '/notifications',
      trim: true,
      maxlength: 200,
    },
    audience: {
      type: String,
      enum: BROADCAST_AUDIENCES,
      default: 'all',
    },
    role: {
      type: String,
      default: null,
      trim: true,
      maxlength: 40,
    },
    examGoal: {
      type: String,
      default: null,
      trim: true,
      maxlength: 40,
    },
    scheduleAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: BROADCAST_STATUSES,
      default: 'pending',
      index: true,
    },
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    result: {
      type: {
        sent: Number,
        matchedUsers: Number,
        audience: String,
      },
      default: null,
    },
    error: {
      type: String,
      default: '',
      maxlength: 500,
    },
  },
  { timestamps: true, collection: 'scheduled_broadcasts' },
);

scheduledBroadcastSchema.index({ status: 1, scheduleAt: 1 });

const ScheduledBroadcast = mongoose.model(
  'ScheduledBroadcast',
  scheduledBroadcastSchema,
);

module.exports = {
  ScheduledBroadcast,
  BROADCAST_STATUSES,
  BROADCAST_AUDIENCES,
};
