'use strict';

const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    folderName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 60,
    },
    /** Bookmarks are always private to the owner (FEED-008). */
    isPrivate: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, collection: 'feed_bookmarks' },
);

bookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true });
bookmarkSchema.index({ userId: 1, folderName: 1, createdAt: -1 });

const Bookmark = mongoose.model('FeedBookmark', bookmarkSchema);

module.exports = { Bookmark };
