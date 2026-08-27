'use strict';

const mongoose = require('mongoose');

const pollVoteSchema = new mongoose.Schema(
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
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { timestamps: true, collection: 'feed_poll_votes' },
);

pollVoteSchema.index({ postId: 1, userId: 1 }, { unique: true });

const PollVote = mongoose.model('FeedPollVote', pollVoteSchema);

module.exports = { PollVote };
