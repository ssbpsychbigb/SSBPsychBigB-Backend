'use strict';

const webpush = require('web-push');
const { PushSubscription } = require('./push-subscription.model');
const { logger } = require('../../common/utils/logger');

let configured = false;

function ensureVapid() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:ops@bigb.app';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Persist or refresh a browser push subscription.
 */
async function saveSubscription({ userId, subscription, userAgent = '' }) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid push subscription');
  }
  return PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: String(userAgent || '').slice(0, 400),
      },
    },
    { upsert: true, new: true },
  );
}

async function removeSubscription({ userId, endpoint }) {
  const filter = { userId };
  if (endpoint) filter.endpoint = endpoint;
  const result = await PushSubscription.deleteMany(filter);
  return { removed: result.deletedCount || 0 };
}

/**
 * Send web push to all of a user's subscriptions. Soft-fail.
 */
async function sendToUser(userId, payload) {
  if (!ensureVapid()) return { sent: 0, skipped: 'not_configured' };

  const rows = await PushSubscription.find({ userId }).lean();
  if (!rows.length) return { sent: 0 };

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let sent = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: row.keys,
        },
        body,
      );
      sent += 1;
    } catch (error) {
      const status = error?.statusCode;
      if (status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: row._id });
      } else {
        logger.warn('Web push failed', {
          message: error?.message,
          status,
          userId: String(userId),
        });
      }
    }
  }
  return { sent };
}

module.exports = {
  getPublicKey,
  isPushConfigured,
  saveSubscription,
  removeSubscription,
  sendToUser,
};
