'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { ACCOUNT_STATUS } = require('../auth/auth.constants');
const { User } = require('../auth/user.model');
const { notificationService } = require('../notifications/notification.service');
const {
  ScheduledBroadcast,
  BROADCAST_AUDIENCES,
} = require('./scheduled-broadcast.model');

function serializeBroadcast(doc) {
  return {
    id: String(doc._id),
    headline: doc.headline || '',
    message: doc.message || '',
    href: doc.href || '/notifications',
    audience: doc.audience || 'all',
    role: doc.role || null,
    examGoal: doc.examGoal || null,
    scheduleAt: doc.scheduleAt
      ? new Date(doc.scheduleAt).toISOString()
      : null,
    status: doc.status,
    sentAt: doc.sentAt ? new Date(doc.sentAt).toISOString() : null,
    result: doc.result || null,
    error: doc.error || '',
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

function parsePayload(body = {}) {
  const message = String(body.message || '').trim();
  if (message.length < 3) {
    throw new AppError(
      'Message must be at least 3 characters',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'EMPTY_BROADCAST' },
    );
  }

  const audience = BROADCAST_AUDIENCES.includes(body.audience)
    ? body.audience
    : 'all';

  return {
    message: message.slice(0, 2000),
    headline: String(body.headline || 'Announcement from BIGB')
      .trim()
      .slice(0, 120),
    href: String(body.href || '/notifications')
      .trim()
      .slice(0, 200),
    audience,
    role: audience === 'role' ? String(body.role || '').trim() || null : null,
    examGoal:
      audience === 'exam'
        ? String(body.examGoal || '')
            .trim()
            .toLowerCase() || null
        : null,
  };
}

async function resolveActorUserId() {
  const actorUser = await User.findOne({
    accountStatus: ACCOUNT_STATUS.ACTIVE,
    role: { $in: ['aspirant', 'defence_officer', 'educator'] },
  })
    .select('_id')
    .lean();
  return actorUser?._id || null;
}

async function runImmediateBroadcast(payload) {
  const actorUserId = await resolveActorUserId();
  return notificationService.adminBroadcast({
    ...payload,
    actorUserId,
  });
}

/**
 * Create a pending scheduled broadcast (NOTIF-S07).
 */
async function scheduleBroadcast({ body, adminId = null }) {
  const payload = parsePayload(body);
  const scheduleAt = new Date(body.scheduleAt);
  if (Number.isNaN(scheduleAt.getTime())) {
    throw new AppError('Invalid schedule time', HTTP_STATUS.BAD_REQUEST, {
      code: 'INVALID_SCHEDULE_AT',
    });
  }
  if (scheduleAt.getTime() <= Date.now() + 30_000) {
    throw new AppError(
      'Schedule time must be at least 30 seconds in the future',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'SCHEDULE_TOO_SOON' },
    );
  }

  const doc = await ScheduledBroadcast.create({
    ...payload,
    scheduleAt,
    status: 'pending',
    createdByAdminId:
      adminId && mongoose.Types.ObjectId.isValid(adminId) ? adminId : null,
  });

  return serializeBroadcast(doc);
}

async function listBroadcasts({ status = '', limit = 40 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const filter = {};
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized) {
    filter.status = normalized;
  }

  const rows = await ScheduledBroadcast.find(filter)
    .sort({ scheduleAt: -1, createdAt: -1 })
    .limit(take)
    .lean();

  return { items: rows.map(serializeBroadcast) };
}

async function cancelBroadcast(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Broadcast not found', HTTP_STATUS.NOT_FOUND, {
      code: 'BROADCAST_NOT_FOUND',
    });
  }
  const doc = await ScheduledBroadcast.findById(id);
  if (!doc) {
    throw new AppError('Broadcast not found', HTTP_STATUS.NOT_FOUND, {
      code: 'BROADCAST_NOT_FOUND',
    });
  }
  if (doc.status !== 'pending') {
    throw new AppError(
      'Only pending broadcasts can be cancelled',
      HTTP_STATUS.BAD_REQUEST,
      { code: 'BROADCAST_NOT_PENDING' },
    );
  }
  doc.status = 'cancelled';
  await doc.save();
  return serializeBroadcast(doc);
}

/**
 * Claim and send due pending broadcasts.
 */
async function processDueBroadcasts() {
  const now = new Date();
  const due = await ScheduledBroadcast.find({
    status: 'pending',
    scheduleAt: { $lte: now },
  })
    .sort({ scheduleAt: 1 })
    .limit(10);

  let processed = 0;
  for (const doc of due) {
    const claimed = await ScheduledBroadcast.findOneAndUpdate(
      { _id: doc._id, status: 'pending' },
      { $set: { status: 'sending' } },
      { new: true },
    );
    if (!claimed) continue;

    try {
      const result = await runImmediateBroadcast({
        message: claimed.message,
        headline: claimed.headline,
        href: claimed.href,
        audience: claimed.audience,
        role: claimed.role,
        examGoal: claimed.examGoal,
      });
      claimed.status = 'sent';
      claimed.sentAt = new Date();
      claimed.result = {
        sent: result.sent || 0,
        matchedUsers: result.matchedUsers || 0,
        audience: result.audience || claimed.audience,
      };
      claimed.error = '';
      await claimed.save();
      processed += 1;
    } catch (error) {
      claimed.status = 'failed';
      claimed.error = String(error?.message || error).slice(0, 500);
      await claimed.save();
    }
  }

  return { processed };
}

module.exports = {
  parsePayload,
  runImmediateBroadcast,
  scheduleBroadcast,
  listBroadcasts,
  cancelBroadcast,
  processDueBroadcasts,
  serializeBroadcast,
};
