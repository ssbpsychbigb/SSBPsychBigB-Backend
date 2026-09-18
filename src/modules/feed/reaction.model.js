'use strict';

const mongoose = require('mongoose');
const { REACTION_TYPES } = require('./feed.constants');

const reactionSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reactionType: {
      type: String,
      enum: REACTION_TYPES,
      default: 'like',
      required: true,
    },
  },
  { timestamps: true, collection: 'feed_reactions' },
);

/** One reaction per user per post (type can be switched). */
reactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
reactionSchema.index({ postId: 1, reactionType: 1 });

const Reaction = mongoose.model('FeedReaction', reactionSchema);

module.exports = { Reaction };
