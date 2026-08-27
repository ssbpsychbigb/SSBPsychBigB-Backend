'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Notification } = require('./notification.model');
const {
  NotificationPrefs,
  DEFAULT_CATEGORIES,
} = require('./notification-prefs.model');
const { Follow } = require('../feed/follow.model');
const { User } = require('../auth/user.model');
const { ACCOUNT_STATUS } = require('../auth/auth.constants');
const { logger } = require('../../common/utils/logger');
const pushService = require('./push.service');

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
  moderation: 'moderation update',
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
  moderation: 'alerts',
};

function categoryForKind(kind, meta = {}) {
  if (kind === 'broadcast' && meta.communitySlug) return 'community';
  return CATEGORIES[kind] || 'alerts';
}

function parseHm(value, fallbackMinutes) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackMinutes;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return fallbackMinutes;
  return h * 60 + m;
}

/**
 * Quiet hours in a timezone (Asia/Kolkata default). Supports overnight ranges.
 */
function isInQuietHours(prefs, now = new Date()) {
  const qh = prefs?.quietHours;
  if (!qh?.enabled) return false;
  const tz = qh.timezone || 'Asia/Kolkata';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const current = hour * 60 + minute;
  const start = parseHm(qh.start, 22 * 60);
  const end = parseHm(qh.end, 7 * 60);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function serializePrefs(doc) {
  const categories = { ...DEFAULT_CATEGORIES, ...(doc?.categories || {}) };
  return {
    categories,
    quietHours: {
      enabled: Boolean(doc?.quietHours?.enabled),
      start: doc?.quietHours?.start || '22:00',
      end: doc?.quietHours?.end || '07:00',
      timezone: doc?.quietHours?.timezone || 'Asia/Kolkata',
    },
    pushEnabled: Boolean(doc?.pushEnabled),
    pushConfigured: pushService.isPushConfigured(),
    readReceiptsEnabled:
      doc?.readReceiptsEnabled === undefined
        ? true
        : Boolean(doc.readReceiptsEnabled),
  };
}

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

  if (kind === 'moderation') {
    const postHref =
      doc.entityType === 'post' && doc.entityId
        ? `/posts/${doc.entityId}`
        : '/notifications';
    return {
      id: String(doc._id),
      kind: 'moderation',
      category: 'alerts',
      actors: [{ name: 'BIGB Moderation', kind: 'system' }],
      headline: meta.headline || 'A moderator took action on your content',
      detail: excerpt(meta.excerpt || '') || undefined,
      createdAt,
      unread: Boolean(doc.unread),
      href: postHref,
      actions: [],
    };
  }

  if (kind === 'broadcast' && meta.systemBroadcast) {
    return {
      id: String(doc._id),
      kind: 'broadcast',
      category: 'alerts',
      actors: [{ name: 'BIGB', kind: 'system' }],
      headline: meta.headline || 'Announcement from BIGB',
      detail: excerpt(meta.excerpt || '') || undefined,
      createdAt,
      unread: Boolean(doc.unread),
      href: meta.href || '/notifications',
      actions: [],
    };
  }

  if (kind === 'broadcast' && meta.communitySlug) {
    const communityName = meta.communityName || meta.communitySlug;
    return {
      id: String(doc._id),
      kind: 'broadcast',
      category: 'community',
      actors: [
        {
          id: actor?._id ? String(actor._id) : undefined,
          name: actor?.fullName || 'Moderator',
          username: actor?.username || '',
          kind: 'person',
        },
      ],
      headline: `announced in ${communityName}`,
      detail: excerpt(meta.excerpt || '') || undefined,
      createdAt,
      unread: Boolean(doc.unread),
      href: `/c/${meta.communitySlug}`,
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
    category: categoryForKind(kind, meta),
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
   * Insert one in-app notification. Skips self, prefs-off categories, and unread dupes in 24h.
   */
  async notify({ actor, recipientId, kind, entityType, entityId, meta = {} }) {
    if (!actor?._id || !recipientId || !kind) return null;
    if (String(actor._id) === String(recipientId)) return null;

    const prefs = await this.getPrefsDoc(recipientId);
    const category = categoryForKind(kind, meta);
    if (prefs.categories?.[category] === false) return null;

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

    const created = await Notification.create({
      recipientId,
      actorId: actor._id,
      kind,
      entityType: entityType || 'user',
      entityId: entityId || actor._id,
      unread: true,
      meta,
    });

    await this.safe(() => this.#maybePush(recipientId, created, prefs, actor));
    return created;
  }

  async getPrefsDoc(userId) {
    const doc = await NotificationPrefs.findOne({ userId }).lean();
    if (!doc) {
      return {
        categories: { ...DEFAULT_CATEGORIES },
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '07:00',
          timezone: 'Asia/Kolkata',
        },
        pushEnabled: false,
        readReceiptsEnabled: true,
      };
    }
    return {
      categories: { ...DEFAULT_CATEGORIES, ...(doc.categories || {}) },
      quietHours: doc.quietHours || {
        enabled: false,
        start: '22:00',
        end: '07:00',
        timezone: 'Asia/Kolkata',
      },
      pushEnabled: Boolean(doc.pushEnabled),
      readReceiptsEnabled:
        doc.readReceiptsEnabled === undefined
          ? true
          : Boolean(doc.readReceiptsEnabled),
    };
  }

  async getPreferences(userId) {
    const doc = await NotificationPrefs.findOne({ userId }).lean();
    return serializePrefs(doc);
  }

  async updatePreferences(userId, body = {}) {
    const current = await this.getPreferences(userId);
    const nextCategories = { ...current.categories };
    if (body.categories && typeof body.categories === 'object') {
      for (const key of Object.keys(DEFAULT_CATEGORIES)) {
        if (typeof body.categories[key] === 'boolean') {
          nextCategories[key] = body.categories[key];
        }
      }
    }

    const quietHours = { ...current.quietHours };
    if (body.quietHours && typeof body.quietHours === 'object') {
      if (typeof body.quietHours.enabled === 'boolean') {
        quietHours.enabled = body.quietHours.enabled;
      }
      if (typeof body.quietHours.start === 'string' && /^\d{1,2}:\d{2}$/.test(body.quietHours.start)) {
        quietHours.start = body.quietHours.start;
      }
      if (typeof body.quietHours.end === 'string' && /^\d{1,2}:\d{2}$/.test(body.quietHours.end)) {
        quietHours.end = body.quietHours.end;
      }
      if (typeof body.quietHours.timezone === 'string' && body.quietHours.timezone.trim()) {
        quietHours.timezone = body.quietHours.timezone.trim().slice(0, 64);
      }
    }

    const pushEnabled =
      typeof body.pushEnabled === 'boolean'
        ? body.pushEnabled
        : current.pushEnabled;

    const readReceiptsEnabled =
      typeof body.readReceiptsEnabled === 'boolean'
        ? body.readReceiptsEnabled
        : current.readReceiptsEnabled !== false;

    const doc = await NotificationPrefs.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          categories: nextCategories,
          quietHours,
          pushEnabled,
          readReceiptsEnabled,
        },
      },
      { upsert: true, new: true },
    ).lean();

    return serializePrefs(doc);
  }

  /**
   * Platform admin broadcast → filtered app users (NOTIF-S04).
   */
  async adminBroadcast({
    message,
    headline = 'Announcement from BIGB',
    href = '/notifications',
    audience = 'all',
    role = null,
    examGoal = null,
    actorUserId = null,
  }) {
    const excerptText = excerpt(message, 280);
    if (!excerptText) {
      throw new AppError('Broadcast message is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMPTY_BROADCAST',
      });
    }

    const filter = { accountStatus: ACCOUNT_STATUS.ACTIVE };
    if (audience === 'role' && role) {
      filter.role = String(role).trim();
    }
    if (audience === 'exam' && examGoal) {
      filter.examGoal = String(examGoal).trim().toLowerCase();
    }

    const users = await User.find(filter).select('_id').lean();
    if (!users.length) {
      return { sent: 0 };
    }

    const prefsRows = await NotificationPrefs.find({
      userId: { $in: users.map((u) => u._id) },
    }).lean();
    const prefsByUser = new Map(
      prefsRows.map((row) => [String(row.userId), row]),
    );

    const actorId =
      actorUserId && mongoose.Types.ObjectId.isValid(actorUserId)
        ? actorUserId
        : users[0]._id;

    const docs = [];
    for (const user of users) {
      const raw = prefsByUser.get(String(user._id));
      const categories = { ...DEFAULT_CATEGORIES, ...(raw?.categories || {}) };
      if (categories.alerts === false) continue;
      docs.push({
        recipientId: user._id,
        actorId,
        kind: 'broadcast',
        entityType: 'system',
        entityId: user._id,
        unread: true,
        meta: {
          systemBroadcast: true,
          headline,
          excerpt: excerptText,
          href: href || '/notifications',
        },
      });
    }

    const chunk = 250;
    for (let i = 0; i < docs.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Notification.insertMany(docs.slice(i, i + chunk), { ordered: false });
    }

    // Push a sample of users (respect quiet hours) — batch soft-send
    for (const doc of docs.slice(0, 200)) {
      // eslint-disable-next-line no-await-in-loop
      await this.safe(async () => {
        const prefs = await this.getPrefsDoc(doc.recipientId);
        if (!prefs.pushEnabled || isInQuietHours(prefs)) return;
        await pushService.sendToUser(doc.recipientId, {
          title: headline,
          body: excerptText,
          href: href || '/notifications',
        });
      });
    }

    return { sent: docs.length, audience, matchedUsers: users.length };
  }

  /**
   * Community announcement → all members (NOTIF-S05).
   */
  async notifyCommunityAnnouncement({ actor, post, community }) {
    if (!actor?._id || !post?._id || !community?._id) return null;

    const { CommunityMembership } = require('../community/community.model');
    const members = await CommunityMembership.find({
      communityId: community._id,
    })
      .select('userId')
      .lean();

    const skip = new Set([String(actor._id)]);
    const recipientIds = [
      ...new Set(members.map((m) => String(m.userId))),
    ].filter((id) => !skip.has(id) && mongoose.Types.ObjectId.isValid(id));

    if (!recipientIds.length) return { sent: 0 };

    const prefsRows = await NotificationPrefs.find({
      userId: { $in: recipientIds },
    }).lean();
    const prefsByUser = new Map(
      prefsRows.map((row) => [String(row.userId), row]),
    );

    const excerptText =
      excerpt(post.content) || `New announcement in ${community.name}`;
    const postId = post._id || post.id;
    const docs = [];
    for (const recipientId of recipientIds) {
      const raw = prefsByUser.get(String(recipientId));
      const categories = { ...DEFAULT_CATEGORIES, ...(raw?.categories || {}) };
      if (categories.community === false) continue;
      docs.push({
        recipientId,
        actorId: actor._id,
        kind: 'broadcast',
        entityType: 'post',
        entityId: postId,
        unread: true,
        meta: {
          excerpt: excerptText,
          communitySlug: community.slug,
          communityName: community.name,
          communityId: String(community._id),
        },
      });
    }

    const chunk = 250;
    for (let i = 0; i < docs.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Notification.insertMany(docs.slice(i, i + chunk), { ordered: false });
    }

    for (const doc of docs.slice(0, 100)) {
      // eslint-disable-next-line no-await-in-loop
      await this.safe(async () => {
        const prefs = await this.getPrefsDoc(doc.recipientId);
        if (!prefs.pushEnabled || isInQuietHours(prefs)) return;
        await pushService.sendToUser(doc.recipientId, {
          title: community.name,
          body: excerptText,
          href: `/c/${community.slug}`,
        });
      });
    }

    return { sent: docs.length };
  }

  async #maybePush(recipientId, notification, prefs, actor) {
    if (!prefs?.pushEnabled || isInQuietHours(prefs)) return;
    if (!pushService.isPushConfigured()) return;

    const meta = notification.meta || {};
    const title =
      meta.headline ||
      actor?.fullName ||
      actor?.instituteName ||
      'BIGB';
    const body =
      HEADLINES[notification.kind] ||
      excerpt(meta.excerpt) ||
      'You have a new notification';
    const href =
      notification.kind === 'follow'
        ? `/u/${actor?.username || ''}`
        : notification.entityType === 'post' && notification.entityId
          ? `/posts/${notification.entityId}`
          : '/notifications';

    await pushService.sendToUser(recipientId, { title, body, href });
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
   * System notice after a moderator action (hide / warn / lock / remove comment).
   */
  async notifyModeration({ recipientId, action, postId = null, excerptText = '' }) {
    if (!recipientId || !action) return null;

    const headlines = {
      hide: 'A moderator hid your post',
      warn: 'You received a community warning',
      comment_removed: 'A moderator removed your comment',
      lock_comments: 'Comments were locked on your post',
    };

    return Notification.create({
      recipientId,
      actorId: recipientId,
      kind: 'moderation',
      entityType: postId ? 'post' : 'user',
      entityId: postId || recipientId,
      unread: true,
      meta: {
        action,
        excerpt: excerpt(excerptText),
        headline: headlines[action] || 'A moderator took action on your content',
      },
    });
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
        if (row.kind !== 'reminder' && row.kind !== 'moderation' && !actor) return null;
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
