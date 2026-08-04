'use strict';

const mongoose = require('mongoose');
const {
  POST_TYPES,
  POST_STATUS,
  POST_VISIBILITY,
  MEDIA_TYPES,
  POST_CATEGORIES,
  ACHIEVEMENT_KINDS,
  FEED_LIMITS,
} = require('./feed.constants');

const mediaSchema = new mongoose.Schema(
  {
    mediaType: {
      type: String,
      enum: Object.values(MEDIA_TYPES),
      required: true,
    },
    url: { type: String, required: true, trim: true },
    thumbnail: { type: String, default: '', trim: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
  },
  { _id: true },
);

const pollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 120 },
    votes: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const pollSchema = new mongoose.Schema(
  {
    options: {
      type: [pollOptionSchema],
      default: [],
    },
    duration: {
      type: String,
      enum: ['1d', '3d', '7d', '30d', 'never'],
      default: '7d',
    },
    endsAt: { type: Date, default: null },
  },
  { _id: false },
);

const questionSchema = new mongoose.Schema(
  {
    isAskMentor: { type: Boolean, default: false },
    acceptedAnswerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedComment',
      default: null,
    },
  },
  { _id: false },
);

const achievementSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ACHIEVEMENT_KINDS,
      default: 'other',
    },
    board: { type: String, default: '', trim: true },
    date: { type: Date, default: null },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    /** For "recommended" stories — pending until admin verifies later. */
    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none',
    },
  },
  { _id: false },
);

const statsSchema = new mongoose.Schema(
  {
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },
    saves: { type: Number, default: 0, min: 0 },
    reports: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const postSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(POST_TYPES),
      required: true,
      default: POST_TYPES.TEXT,
    },
    content: {
      type: String,
      default: '',
      trim: true,
      maxlength: FEED_LIMITS.MAX_TEXT_LENGTH,
    },
    visibility: {
      type: String,
      enum: Object.values(POST_VISIBILITY),
      required: true,
      default: POST_VISIBILITY.PUBLIC,
    },
    categories: {
      type: [{ type: String, enum: POST_CATEGORIES }],
      default: [],
    },
    educationalScore: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(POST_STATUS),
      required: true,
      default: POST_STATUS.PUBLISHED,
      index: true,
    },
    media: { type: [mediaSchema], default: [] },
    poll: { type: pollSchema, default: null },
    question: { type: questionSchema, default: null },
    achievement: { type: achievementSchema, default: null },
    hashtags: { type: [String], default: [], index: true },
    mentions: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    stats: { type: statsSchema, default: () => ({}) },
    trendingScore: { type: Number, default: 0, index: true },
    pinnedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    /** Soft-delete timestamp — recovery until SOFT_DELETE_RECOVERY_DAYS. */
    deletedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    collection: 'posts',
  },
);

postSchema.index({ status: 1, visibility: 1, createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ status: 1, trendingScore: -1, createdAt: -1 });
postSchema.index({ authorId: 1, status: 1, pinnedAt: -1 });

const Post = mongoose.model('Post', postSchema);

module.exports = { Post };
