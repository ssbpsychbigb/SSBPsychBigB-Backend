'use strict';

const mongoose = require('mongoose');

/**
 * Lightweight analytics event store for Feed §4.13 hooks.
 * Module 13 can aggregate later — writes must never block product flows.
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      default: null,
      index: true,
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'feed_analytics_events' },
);

analyticsEventSchema.index({ createdAt: -1 });

const FeedAnalyticsEvent = mongoose.model(
  'FeedAnalyticsEvent',
  analyticsEventSchema,
);

/**
 * Fire-and-forget emit. Never throws to callers.
 * @param {{ event: string, userId?: string | null, postId?: string | null, meta?: object }} input
 */
function emitFeedEvent(input) {
  const event = String(input?.event || '').trim();
  if (!event) return;

  const doc = {
    event,
    userId:
      input.userId && mongoose.Types.ObjectId.isValid(input.userId)
        ? input.userId
        : null,
    postId:
      input.postId && mongoose.Types.ObjectId.isValid(input.postId)
        ? input.postId
        : null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
  };

  void FeedAnalyticsEvent.create(doc).catch(() => {
    // Intentionally swallow — analytics must not break feed APIs.
  });
}

module.exports = { emitFeedEvent, FeedAnalyticsEvent };
