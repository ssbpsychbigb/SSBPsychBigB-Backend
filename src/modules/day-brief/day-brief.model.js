'use strict';

const mongoose = require('mongoose');
const { DAY_BRIEF_LIMITS, DAY_BRIEF_MEDIA_TYPES } = require('./day-brief.constants');

const dayBriefSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    caption: {
      type: String,
      default: '',
      trim: true,
      maxlength: DAY_BRIEF_LIMITS.MAX_CAPTION,
    },
    mediaType: {
      type: String,
      enum: Object.values(DAY_BRIEF_MEDIA_TYPES),
      required: true,
    },
    mediaUrl: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: '',
      trim: true,
    },
    durationSec: {
      type: Number,
      default: DAY_BRIEF_LIMITS.DEFAULT_IMAGE_DURATION_SEC,
      min: 1,
      max: DAY_BRIEF_LIMITS.MAX_DURATION_SEC,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'day_briefs' },
);

dayBriefSchema.index({ authorId: 1, expiresAt: -1 });
dayBriefSchema.index({ expiresAt: 1, createdAt: -1 });

const dayBriefViewSchema = new mongoose.Schema(
  {
    briefId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DayBrief',
      required: true,
      index: true,
    },
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true, collection: 'day_brief_views' },
);

dayBriefViewSchema.index({ briefId: 1, viewerId: 1 }, { unique: true });

const DayBrief = mongoose.model('DayBrief', dayBriefSchema);
const DayBriefView = mongoose.model('DayBriefView', dayBriefViewSchema);

module.exports = { DayBrief, DayBriefView };
