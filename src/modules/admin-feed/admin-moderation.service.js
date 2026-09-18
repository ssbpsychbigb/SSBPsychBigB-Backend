'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Post } = require('../feed/post.model');
const { Comment } = require('../feed/comment.model');
const { Report } = require('../feed/report.model');
const { User } = require('../auth/user.model');
const { POST_STATUS, FEED_LIMITS } = require('../feed/feed.constants');
const { serializePost } = require('../feed/feed.service');
const { serializeComment } = require('../feed/feed-engagement.service');
const { notificationService } = require('../notifications/notification.service');
require('../community/community.model');
const { ModerationLog } = require('./moderation-log.model');
const { UserWarning } = require('./user-warning.model');

const QUEUE_STATUSES = Object.freeze({
  open: ['open'],
  escalated: ['escalated'],
  all: ['open', 'escalated'],
});

const REPORT_CLOSE_STATUSES = ['open', 'escalated'];

function asObjectId(id, code = 'NOT_FOUND') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Not found', HTTP_STATUS.NOT_FOUND, { code });
  }
  return new mongoose.Types.ObjectId(id);
}

function noteFrom(body) {
  return String(body?.note || '').trim().slice(0, 1000);
}

/**
 * @param {object} admin
 * @param {string} action
 * @param {{ targetType: string, targetId: object, postId?: object | null, note?: string, meta?: object }} input
 */
async function logAction(admin, action, input) {
  await ModerationLog.create({
    actorAdminId: admin._id,
    action,
    targetType: input.targetType,
    targetId: input.targetId,
    postId: input.postId || null,
    note: input.note || '',
    meta: input.meta || {},
  });
}

async function loadPost(postId) {
  const id = asObjectId(postId, 'POST_NOT_FOUND');
  const post = await Post.findById(id);
  if (!post || post.status === POST_STATUS.DELETED) {
    throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
      code: 'POST_NOT_FOUND',
    });
  }
  return post;
}

function serializeAdminPost(row, extras = {}) {
  const serialized = serializePost(row, row.authorId);
  const communityDoc =
    row.communityId && typeof row.communityId === 'object' && row.communityId._id
      ? row.communityId
      : null;
  serialized.commentsLocked = Boolean(row.commentsLocked);
  serialized.community = communityDoc
    ? {
        id: String(communityDoc._id),
        name: communityDoc.name || '',
        slug: communityDoc.slug || '',
      }
    : null;
  return { ...serialized, ...extras };
}

/**
 * Platform moderation — hide, warn, resolve reports, lock threads.
 */
class AdminModerationService {
  /**
   * Posts with open or escalated reports (home + community).
   * @param {{ cursor?: string, limit?: number, scope?: string, queue?: string }} input
   */
  async listReportedPosts({ cursor, limit, scope = 'all', queue = 'all' }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );
    const reportStatuses = QUEUE_STATUSES[queue] || QUEUE_STATUSES.all;

    const activeReports = await Report.find({
      status: { $in: reportStatuses },
    })
      .select('postId')
      .lean();

    const postIds = [
      ...new Set(activeReports.map((row) => String(row.postId))),
    ].map((id) => new mongoose.Types.ObjectId(id));

    if (!postIds.length) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const filter = {
      _id: { $in: postIds },
      status: { $in: [POST_STATUS.PUBLISHED, POST_STATUS.HIDDEN] },
    };

    const scopeKey = String(scope || 'all');
    if (scopeKey === 'community') {
      filter.communityId = { $ne: null };
    } else if (scopeKey === 'home') {
      filter.$or = [{ communityId: null }, { communityId: { $exists: false } }];
    }

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $in: postIds, $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ 'stats.reports': -1, _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName username role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .populate('communityId', 'name slug')
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const pageIds = page.map((row) => row._id);

    const [openReports, warningRows] = await Promise.all([
      Report.find({
        postId: { $in: pageIds },
        status: { $in: REPORT_CLOSE_STATUSES },
      })
        .select('postId reason status note createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      UserWarning.aggregate([
        {
          $match: {
            userId: {
              $in: page
                .map((row) => row.authorId?._id || row.authorId)
                .filter(Boolean),
            },
          },
        },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]),
    ]);

    const reportsByPost = new Map();
    for (const row of openReports) {
      const key = String(row.postId);
      const list = reportsByPost.get(key) || [];
      list.push({
        id: String(row._id),
        reason: row.reason,
        status: row.status,
        note: row.note || '',
        createdAt: row.createdAt,
      });
      reportsByPost.set(key, list);
    }

    const warningMap = new Map(
      warningRows.map((row) => [String(row._id), row.count]),
    );

    return {
      items: page.map((row) => {
        const reports = reportsByPost.get(String(row._id)) || [];
        const authorId = String(row.authorId?._id || row.authorId || '');
        return serializeAdminPost(row, {
          openReports: reports,
          openReportCount: reports.length,
          queueStatus: reports.some((item) => item.status === 'escalated')
            ? 'escalated'
            : 'open',
          authorWarningCount: warningMap.get(authorId) || 0,
        });
      }),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  async listPostComments({ postId }) {
    const post = await loadPost(postId);
    const rows = await Comment.find({
      postId: post._id,
      status: 'published',
    })
      .sort({ createdAt: 1, _id: 1 })
      .populate(
        'authorId',
        'fullName username role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    return {
      items: rows.map((row) => serializeComment(row, row.authorId)),
      commentsLocked: Boolean(post.commentsLocked),
    };
  }

  async hidePost({ admin, postId, note = '' }) {
    const post = await loadPost(postId);
    if (post.status === POST_STATUS.HIDDEN) {
      return this._reloadPost(post._id);
    }

    post.status = POST_STATUS.HIDDEN;
    await post.save();
    await logAction(admin, 'hide_post', {
      targetType: 'post',
      targetId: post._id,
      postId: post._id,
      note,
      meta: { previousStatus: POST_STATUS.PUBLISHED },
    });

    await notificationService.safe(() =>
      notificationService.notifyModeration({
        recipientId: post.authorId,
        action: 'hide',
        postId: post._id,
        excerptText: note || post.content,
      }),
    );

    return this._reloadPost(post._id);
  }

  async unhidePost({ admin, postId, note = '' }) {
    const post = await loadPost(postId);
    if (post.status !== POST_STATUS.HIDDEN) {
      throw new AppError('Post is not hidden', HTTP_STATUS.BAD_REQUEST, {
        code: 'POST_NOT_HIDDEN',
      });
    }

    post.status = POST_STATUS.PUBLISHED;
    await post.save();
    await logAction(admin, 'unhide_post', {
      targetType: 'post',
      targetId: post._id,
      postId: post._id,
      note,
    });

    return this._reloadPost(post._id);
  }

  async setCommentsLocked({ admin, postId, locked, note = '' }) {
    const post = await loadPost(postId);
    post.commentsLocked = Boolean(locked);
    await post.save();
    await logAction(admin, locked ? 'lock_comments' : 'unlock_comments', {
      targetType: 'post',
      targetId: post._id,
      postId: post._id,
      note,
    });

    if (locked) {
      await notificationService.safe(() =>
        notificationService.notifyModeration({
          recipientId: post.authorId,
          action: 'lock_comments',
          postId: post._id,
          excerptText: note || post.content,
        }),
      );
    }

    return this._reloadPost(post._id);
  }

  async hideComment({ admin, commentId, note = '' }) {
    const id = asObjectId(commentId, 'COMMENT_NOT_FOUND');
    const comment = await Comment.findById(id);
    if (!comment || comment.status !== 'published') {
      throw new AppError('Comment not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMENT_NOT_FOUND',
      });
    }

    comment.status = 'hidden';
    await comment.save();
    await Post.updateOne(
      { _id: comment.postId, 'stats.comments': { $gt: 0 } },
      { $inc: { 'stats.comments': -1 } },
    );
    await logAction(admin, 'hide_comment', {
      targetType: 'comment',
      targetId: comment._id,
      postId: comment.postId,
      note,
    });

    await notificationService.safe(() =>
      notificationService.notifyModeration({
        recipientId: comment.authorId,
        action: 'comment_removed',
        postId: comment.postId,
        excerptText: note || comment.content,
      }),
    );

    return { id: String(comment._id), hidden: true, postId: String(comment.postId) };
  }

  async resolveReports({ admin, postId, outcome, note = '' }) {
    const allowed = {
      dismiss: 'dismissed',
      resolve: 'resolved',
      escalate: 'escalated',
    };
    const nextStatus = allowed[outcome];
    if (!nextStatus) {
      throw new AppError('Invalid report outcome', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_OUTCOME',
      });
    }

    const post = await loadPost(postId);
    const fromStatuses =
      outcome === 'escalate' ? ['open'] : REPORT_CLOSE_STATUSES;

    const result = await Report.updateMany(
      { postId: post._id, status: { $in: fromStatuses } },
      {
        $set: {
          status: nextStatus,
          reviewedAt: new Date(),
          reviewedByAdminId: admin._id,
          resolutionNote: note,
        },
      },
    );

    const action =
      outcome === 'dismiss'
        ? 'dismiss_reports'
        : outcome === 'resolve'
          ? 'resolve_reports'
          : 'escalate_reports';

    await logAction(admin, action, {
      targetType: 'reports',
      targetId: post._id,
      postId: post._id,
      note,
      meta: { matched: result.matchedCount, modified: result.modifiedCount },
    });

    return {
      postId: String(post._id),
      outcome: nextStatus,
      updated: result.modifiedCount || 0,
    };
  }

  async warnUser({ admin, userId, reason, note = '', postId = null }) {
    const id = asObjectId(userId, 'USER_NOT_FOUND');
    const user = await User.findById(id).select('_id fullName');
    if (!user) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    const why = String(reason || '').trim();
    if (why.length < 8) {
      throw new AppError('Warning reason must be at least 8 characters', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_REASON',
      });
    }

    let linkedPostId = null;
    if (postId) {
      const post = await loadPost(postId);
      linkedPostId = post._id;
    }

    const warning = await UserWarning.create({
      userId: user._id,
      adminId: admin._id,
      postId: linkedPostId,
      reason: why.slice(0, 500),
      note,
    });

    await logAction(admin, 'warn_user', {
      targetType: 'user',
      targetId: user._id,
      postId: linkedPostId,
      note: why,
      meta: { warningId: String(warning._id) },
    });

    await notificationService.safe(() =>
      notificationService.notifyModeration({
        recipientId: user._id,
        action: 'warn',
        postId: linkedPostId,
        excerptText: why,
      }),
    );

    const count = await UserWarning.countDocuments({ userId: user._id });
    return {
      id: String(warning._id),
      userId: String(user._id),
      warningCount: count,
    };
  }

  async _reloadPost(postId) {
    const row = await Post.findById(postId)
      .populate(
        'authorId',
        'fullName username role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .populate('communityId', 'name slug')
      .lean();
    return serializeAdminPost(row);
  }
}

const adminModerationService = new AdminModerationService();

module.exports = { adminModerationService };
