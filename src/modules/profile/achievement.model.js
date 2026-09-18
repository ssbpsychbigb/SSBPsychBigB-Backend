'use strict';

const mongoose = require('mongoose');

const ACHIEVEMENT_CATEGORIES = [
  'ncc',
  'sports',
  'olympiad',
  'award',
  'school_captain',
  'best_cadet',
  'marathon',
  'debate',
  'other',
];

const achievementSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: {
      type: String,
      enum: ACHIEVEMENT_CATEGORIES,
      default: 'other',
    },
    description: { type: String, default: '', trim: true, maxlength: 800 },
    achievementDate: { type: Date, default: null },
    certificateUrl: { type: String, default: '', trim: true },
    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none',
    },
  },
  { timestamps: true, collection: 'user_achievements' },
);

achievementSchema.index({ userId: 1, achievementDate: -1 });

const UserAchievement = mongoose.model('UserAchievement', achievementSchema);

module.exports = { UserAchievement, ACHIEVEMENT_CATEGORIES };
