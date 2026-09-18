'use strict';

const mongoose = require('mongoose');
const { REPORT_REASONS } = require('./feed.constants');

const reportSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['open', 'reviewed', 'dismissed', 'resolved', 'escalated'],
      default: 'open',
      index: true,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    resolutionNote: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true, collection: 'feed_reports' },
);

reportSchema.index({ postId: 1, reporterId: 1 }, { unique: true });

const Report = mongoose.model('FeedReport', reportSchema);

module.exports = { Report };
