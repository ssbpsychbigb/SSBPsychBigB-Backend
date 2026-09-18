'use strict';

const mongoose = require('mongoose');
const { FEED_LIMITS, MEDIA_TYPES } = require('./feed.constants');

const commentMediaSchema = new mongoose.Schema(
  {
    mediaType: {
      type: String,
      enum: [MEDIA_TYPES.IMAGE, MEDIA_TYPES.AUDIO],
      default: MEDIA_TYPES.IMAGE,
    },
    url: { type: String, required: true, trim: true },
    thumbnail: { type: String, default: '', trim: true },
    duration: { type: Number, default: null },
  },
  { _id: true },
);

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    parentCommentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedComment',
      default: null,
      index: true,
    },
    content: {
      type: String,
      default: '',
      trim: true,
      maxlength: FEED_LIMITS.MAX_COMMENT_LENGTH,
    },
    media: {
      type: [commentMediaSchema],
      default: [],
      validate: {
        validator(value) {
          return !value || value.length <= FEED_LIMITS.MAX_COMMENT_IMAGES;
        },
        message: `Comments support at most ${FEED_LIMITS.MAX_COMMENT_IMAGES} image`,
      },
    },
    depth: {
      type: Number,
      default: 0,
      min: 0,
      max: FEED_LIMITS.MAX_COMMENT_DEPTH,
    },
    status: {
      type: String,
      enum: ['published', 'deleted', 'hidden'],
      default: 'published',
      index: true,
    },
  },
  { timestamps: true, collection: 'feed_comments' },
);

commentSchema.index({ postId: 1, parentCommentId: 1, createdAt: 1 });

const Comment = mongoose.model('FeedComment', commentSchema);

module.exports = { Comment };
