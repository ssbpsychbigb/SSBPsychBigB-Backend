'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Notification } = require('./notification.model');
const { Follow } = require('../feed/follow.model');
const { User } = require('../auth/user.model');
const { logger } = require('../../common/utils/logger');

const EXAM_LABELS = {
  nda: 'NDA',
  cds: 'CDS',
  afcat: 'AFCAT',
  ssb: 'SSB Interview',
  capf: 'CAPF',
  agniveer: 'Agniveer',
  inet: 'INET',
  other: 'Other / Exploring',
};

const DEDUPE_MS = 24 * 60 * 60 * 1000;

const HEADLINES = {
  follow: 'started following you',
  like: 'liked your post',
  comment: 'commented on your post',
  reply: 'replied to your comment',
  mention: 'mentioned you',
  share: 'shared your post',
  broadcast: 'posted an announcement',
  reminder: 'reminder',
  course: 'published a course',
  assessment: 'published an assessment',
};

const CATEGORIES = {
  follow: 'network',
  like: 'social',
  comment: 'social',
  reply: 'social',
  mention: 'mentions',
  share: 'social',
  broadcast: 'alerts',
  reminder: 'learning',
  course: 'learning',
  assessment: 'learning',
};

function actorKind(role) {
  if (role === 'institute') return 'institute';
  return 'person';
}

function actorDetail(user) {
  const exam = EXAM_LABELS[user.examGoal] || '';
  const city = String(user.city || '').trim();
  return [exam, city].filter(Boolean).join(' · ');
}

function excerpt(text, max = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function resolveBroadcastSource(actor) {
  if (!actor) return null;
  if (actor.role === 'institute') return actor;
  if (actor.role === 'institute_admin' && actor.instituteId) {
    return User.findById(actor.instituteId).select(
      'fullName username role instituteName',
    );
  }
  return null;
}

function serializeItem(doc, actor, followingAuthor) {
  const username = actor?.username || (actor?._id ? String(actor._id) : '');
  const kind = doc.kind;
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const createdAt = doc.createdAt
    ? new Date(doc.createdAt).toISOString()
    : new Date().toISOString();

  if (kind === 'reminder') {
    return {
      id: String(doc._id),
      kind: 'reminder',
      category: 'learning',
      actors: [{ name: 'BIGB', kind: 'system' }],
      headline: meta.excerpt || 'You have an upcoming attempt',
      createdAt,
      unread: Boolean(doc.unread),
      href: '/profile/edit',
      actions: [],
    };
  }

  const isFollow = kind === 'follow';
  const postId = !isFollow && doc.entityId ? String(doc.entityId) : null;
  const detail = isFollow ? actorDetail(actor) : excerpt(meta.excerpt || '');
  const displayName =
    actor.fullName || actor.instituteName || (kind === 'broadcast' ? 'Institute' : 'Member');

  return {
    id: String(doc._id),
    kind,
    category: CATEGORIES[kind] || 'alerts',
    actors: [
      {
        id: String(actor._id),
        name: displayName,
        username,
        kind: actorKind(actor.role),
      },
    ],
    headline: HEADLINES[kind] || 'sent you an update',
    detail: detail || undefined,
    createdAt,
    unread: Boolean(doc.unread),
    href: isFollow ? `/u/${username}` : `/posts/${postId || ''}`,
    actions:
      isFollow && !followingAuthor
        ? [{ id: 'follow_back', label: 'Follow back', variant: 'primary' }]
        : [],
  };
}

/**
 * In-app notifications — follow + social events (Phase C / E).
 */
class NotificationService {
  /**
   * Insert one in-app notification. Skips self and unread dupes in 24h.
   */
  async notify({ actor, recipientId, kind, entityType, entityId, meta = {} }) {
    if (!actor?._id || !recipientId || !kind) return null;
    if (String(actor._id) === String(recipientId)) return null;

    const since = new Date(Date.now() - DEDUPE_MS);
    const filter = {
      recipientId,
      actorId: actor._id,
      kind,
      unread: true,
      deletedAt: null,
      createdAt: { $gte: since },
    };
    if (entityId) filter.entityId = entityId;

    const existing = await Notification.findOne(filter).select('_id');
    if (existing) return existing;

    return Notification.create({
      recipientId,
      actorId: actor._id,
      kind,
      entityType: entityType || 'user',
      entityId: entityId || actor._id,
      unread: true,
      meta,
    });
  }

  async notifyFollow({ actor, recipientId }) {
    return this.notify({
      actor,
      recipientId,
      kind: 'follow',
      entityType: 'user',
      entityId: actor._id,
      meta: {},
    });
  }

  async notifyLike({ actor, post }) {
    if (!post?.authorId) return null;
    return this.notify({
      actor,
      recipientId: post.authorId,
      kind: 'like',
      entityType: 'post',
      entityId: post._id,
      meta: { excerpt: excerpt(post.content) },
    });
  }

  async notifyComment({ actor, post, comment, parent = null }) {
    const text = excerpt(comment?.content);
    if (parent?.authorId) {
      return this.notify({
        actor,
        recipientId: parent.authorId,
        kind: 'reply',
        entityType: 'post',
        entityId: post._id,
        meta: { excerpt: text, commentId: String(comment._id) },
      });
    }
    return this.notify({
      actor,
      recipientId: post.authorId,
      kind: 'comment',
      entityType: 'post',
      entityId: post._id,
      meta: { excerpt: text, commentId: String(comment._id) },
    });
  }

  async resolveMentionIds(text) {
    const handles = [
      ...new Set(
        (String(text || '').match(/@[a-zA-Z0-9_]{3,30}/g) || []).map((hit) =>
          hit.slice(1).toLowerCase(),
        ),
      ),
    ];
    if (!handles.length) return [];
    const users = await User.find({ username: { $in: handles } }).select('_id');
    return users.map((row) => row._id);
  }

  async notifyMentions({ actor, post, mentionUserIds, excerptText, skipIds = [] }) {
    const skip = new Set((skipIds || []).map((id) => String(id)));
    skip.add(String(actor._id));
    const ids = [...new Set((mentionUserIds || []).map((id) => String(id)))].filter(
      (id) => !skip.has(id),
    );
    const text = excerpt(excerptText || post?.content);
    for (const id of ids) {
      await this.notify({
        actor,
        recipientId: id,
        kind: 'mention',
        entityType: 'post',
        entityId: post._id,
        meta: { excerpt: text },
      });
    }
  }

  async notifyShare({ actor, post }) {
    if (!post?.authorId) return null;
    return this.notify({
      actor,
      recipientId: post.authorId,
      kind: 'share',
      entityType: 'post',
      entityId: post._id,
      meta: { excerpt: excerpt(post.content) },
    });
  }

  /**
   * Institute announcement → all followers of the institute account.
   */
  async notifyBroadcast({ actor, post }) {
    const source = await resolveBroadcastSource(actor);
    if (!source?._id || !post?._id) return null;

    const already = await Notification.findOne({
      kind: 'broadcast',
      entityId: post._id,
      deletedAt: null,
    }).select('_id');
    if (already) return already;

    const follows = await Follow.find({ followingId: source._id })
      .select('followerId')
      .lean();
    const skip = new Set([String(source._id), String(actor._id)]);
    const recipientIds = [
      ...new Set(follows.map((row) => String(row.followerId))),
    ].filter((id) => !skip.has(id) && mongoose.Types.ObjectId.isValid(id));
    if (!recipientIds.length) return null;

    const excerptText =
      excerpt(post.content) || 'New announcement from your institute';
    const docs = recipientIds.map((recipientId) => ({
      recipientId,
      actorId: source._id,
      kind: 'broadcast',
      entityType: 'post',
      entityId: post._id,
      unread: true,
      meta: { excerpt: excerptText },
    }));

    const chunk = 250;
    for (let i = 0; i < docs.length; i += chunk) {
      await Notification.insertMany(docs.slice(i, i + chunk), { ordered: false });
    }
    return { sent: docs.length };
  }

  /**
   * LMS hook — fan out a course/assessment alert to the publisher's followers.
   */
  async notifyLearning({ actor, kind, entityId, title, hrefExcerpt }) {
    if (kind !== 'course' && kind !== 'assessment') return null;
    if (!actor?._id) return null;
    const follows = await Follow.find({ followingId: actor._id })
      .select('followerId')
      .lean();
    const recipientIds = [
      ...new Set(follows.map((row) => String(row.followerId))),
    ].filter((id) => id !== String(actor._id));
    if (!recipientIds.length) return null;
    for (const recipientId of recipientIds) {
      await this.notify({
        actor,
        recipientId,
        kind,
        entityType: kind,
        entityId: entityId || actor._id,
        meta: { excerpt: excerpt(title || hrefExcerpt) },
      });
    }
    return { sent: recipientIds.length };
  }

  /**
   * Attempt-date reminder (7-day window). One per week.
   */
  async ensureAttemptReminder(user) {
    if (!user?._id || !user.attemptDate) return null;
    const when = new Date(user.attemptDate).getTime();
    if (Number.isNaN(when)) return null;
    const days = Math.round((when - Date.now()) / (24 * 60 * 60 * 1000));
    if (days < 0 || days > 7) return null;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existing = await Notification.findOne({
      recipientId: user._id,
      kind: 'reminder',
      deletedAt: null,
      createdAt: { $gte: weekAgo },
    }).select('_id');
    if (existing) return existing;

    const excerptText =
      days === 0
        ? 'Your attempt is today. Review your SSB board and prep notes.'
        : `Your attempt is in ${days} day${days === 1 ? '' : 's'}. Keep your prep circle close.`;

    return Notification.create({
      recipientId: user._id,
      actorId: user._id,
      kind: 'reminder',
      entityType: 'user',
      entityId: user._id,
      unread: true,
      meta: { excerpt: excerptText, days },
    });
  }

  /**
   * Never fail the parent action if notify insert errors.
   */
  async safe(fn) {
    try {
      return await fn();
    } catch (error) {
      logger.error('Notification failed', { message: error?.message });
      return null;
    }
  }

  async listForUser(user, { cursor, limit, unreadOnly } = {}) {
    if (!user?._id) {
      throw new AppError('Authentication required', HTTP_STATUS.UNAUTHORIZED, {
        code: 'AUTH_REQUIRED',
      });
    }

    await this.safe(() => this.ensureAttemptReminder(user));

    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = {
      recipientId: user._id,
      deletedAt: null,
    };
    if (String(unreadOnly) === 'true' || unreadOnly === true) {
      filter.unread = true;
    }
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const [rows, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ _id: -1 }).limit(pageSize + 1).lean(),
      Notification.countDocuments({
        recipientId: user._id,
        deletedAt: null,
        unread: true,
      }),
    ]);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const actorIds = [...new Set(page.map((row) => String(row.actorId)))];

    const actors = actorIds.length
      ? await User.find({ _id: { $in: actorIds } }).select(
          'fullName username role examGoal city instituteName',
        )
      : [];
    const actorMap = new Map(actors.map((a) => [String(a._id), a]));

    let followingSet = new Set();
    if (actorIds.length) {
      const follows = await Follow.find({
        followerId: user._id,
        followingId: { $in: actorIds },
      })
        .select('followingId')
        .lean();
      followingSet = new Set(follows.map((row) => String(row.followingId)));
    }

    const items = page
      .map((row) => {
        const actor = actorMap.get(String(row.actorId));
        if (!HEADLINES[row.kind]) return null;
        if (row.kind !== 'reminder' && !actor) return null;
        return serializeItem(
          row,
          actor,
          followingSet.has(String(row.actorId)),
        );
      })
      .filter(Boolean);

    return {
      items,
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
      unreadCount,
    };
  }

  async unreadCount(user) {
    if (!user?._id) return { unreadCount: 0 };
    await this.safe(() => this.ensureAttemptReminder(user));
    const unreadCount = await Notification.countDocuments({
      recipientId: user._id,
      deletedAt: null,
      unread: true,
    });
    return { unreadCount };
  }

  async markRead(user, id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Notification not found', HTTP_STATUS.NOT_FOUND, {
        code: 'NOTIFICATION_NOT_FOUND',
      });
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: id, recipientId: user._id, deletedAt: null },
      { $set: { unread: false } },
      { new: true },
    );
    if (!updated) {
      throw new AppError('Notification not found', HTTP_STATUS.NOT_FOUND, {
        code: 'NOTIFICATION_NOT_FOUND',
      });
    }
    return { id: String(updated._id), unread: false };
  }

  async markAllRead(user) {
    const result = await Notification.updateMany(
      { recipientId: user._id, deletedAt: null, unread: true },
      { $set: { unread: false } },
    );
    return { updated: result.modifiedCount || 0 };
  }

  async remove(user, id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Notification not found', HTTP_STATUS.NOT_FOUND, {
        code: 'NOTIFICATION_NOT_FOUND',
      });
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: id, recipientId: user._id, deletedAt: null },
      { $set: { deletedAt: new Date(), unread: false } },
      { new: true },
    );
    if (!updated) {
      throw new AppError('Notification not found', HTTP_STATUS.NOT_FOUND, {
        code: 'NOTIFICATION_NOT_FOUND',
      });
    }
    return { id: String(updated._id), deleted: true };
  }
}

const notificationService = new NotificationService();

module.exports = { notificationService, excerpt };
