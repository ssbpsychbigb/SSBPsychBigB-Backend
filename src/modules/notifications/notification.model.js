'use strict';

const mongoose = require('mongoose');

const NOTIFICATION_KINDS = [
  'follow',
  'like',
  'comment',
  'reply',
  'mention',
  'share',
  'broadcast',
  'reminder',
  'course',
  'assessment',
];

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      required: true,
      enum: NOTIFICATION_KINDS,
    },
    entityType: {
      type: String,
      default: 'user',
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    unread: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true, collection: 'notifications' },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, unread: 1, deletedAt: 1 });
notificationSchema.index({
  recipientId: 1,
  actorId: 1,
  kind: 1,
  unread: 1,
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification, NOTIFICATION_KINDS };
