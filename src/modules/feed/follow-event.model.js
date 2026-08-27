'use strict';

const mongoose = require('mongoose');

const followEventSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['unfollow'],
      required: true,
      default: 'unfollow',
    },
  },
  { timestamps: true, collection: 'feed_follow_events' },
);

followEventSchema.index({ targetId: 1, kind: 1, createdAt: -1 });

const FollowEvent = mongoose.model('FeedFollowEvent', followEventSchema);

module.exports = { FollowEvent };
