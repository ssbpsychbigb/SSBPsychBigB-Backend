'use strict';

const mongoose = require('mongoose');

/**
 * Named Saved collections (FEED-008) — can exist empty before any posts are saved.
 */
const bookmarkCollectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
  },
  { timestamps: true, collection: 'feed_bookmark_collections' },
);

bookmarkCollectionSchema.index({ userId: 1, name: 1 }, { unique: true });

const BookmarkCollection = mongoose.model(
  'FeedBookmarkCollection',
  bookmarkCollectionSchema,
);

module.exports = { BookmarkCollection };
