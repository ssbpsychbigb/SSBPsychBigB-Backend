'use strict';

const mongoose = require('mongoose');

const MODERATION_ACTIONS = Object.freeze([
  'hide_post',
  'unhide_post',
  'lock_comments',
  'unlock_comments',
  'hide_comment',
  'warn_user',
  'dismiss_reports',
  'resolve_reports',
  'escalate_reports',
  'dismiss_chat_report',
  'review_chat_report',
  'resolve_chat_report',
]);

const moderationLogSchema = new mongoose.Schema(
  {
    actorAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: MODERATION_ACTIONS,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['post', 'comment', 'user', 'reports', 'chat_report', 'conversation'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      default: null,
      index: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true, collection: 'moderation_logs' },
);

moderationLogSchema.index({ createdAt: -1 });

const ModerationLog = mongoose.model('ModerationLog', moderationLogSchema);

module.exports = { ModerationLog, MODERATION_ACTIONS };
