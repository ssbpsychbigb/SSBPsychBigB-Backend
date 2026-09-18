'use strict';

const mongoose = require('mongoose');

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'feed_follows' },
);

followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

const Follow = mongoose.model('FeedFollow', followSchema);

module.exports = { Follow };
