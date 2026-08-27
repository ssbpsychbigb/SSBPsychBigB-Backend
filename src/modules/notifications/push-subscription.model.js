'use strict';

const mongoose = require('mongoose');

/**
 * Web Push subscriptions (VAPID) — Wave 5 NOTIF-S03.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: {
      type: String,
      default: '',
      maxlength: 400,
    },
  },
  { timestamps: true, collection: 'push_subscriptions' },
);

pushSubscriptionSchema.index({ userId: 1, createdAt: -1 });

const PushSubscription = mongoose.model(
  'PushSubscription',
  pushSubscriptionSchema,
);

module.exports = { PushSubscription };
