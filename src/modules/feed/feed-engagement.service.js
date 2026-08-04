'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Post } = require('./post.model');
const { Reaction } = require('./reaction.model');
const { Comment } = require('./comment.model');
const { Bookmark } = require('./bookmark.model');
const { BookmarkCollection } = require('./bookmark-collection.model');
const { Report } = require('./report.model');
const { Follow } = require('./follow.model');
const {
  POST_STATUS,
  FEED_LIMITS,
  MEDIA_TYPES,
  REACTION_TYPES,
  REPORT_REASONS,
} = require('./feed.constants');
const { serializePost } = require('./feed.service');
const config = require('../../config');
const { refreshTrendingScore } = require('./feed-score');
const { emitFeedEvent } = require('./feed-analytics');

/**
 * @param {object} authorDoc
 */
function serializeAuthor(authorDoc) {
  if (!authorDoc) {
    return null;
  }
  return {
    id: String(authorDoc._id),
    fullName: authorDoc.fullName || '',
    role: authorDoc.role,
    verificationLevel: authorDoc.verificationLevel ?? 0,
    profilePhotoPath:
      authorDoc.profilePhotoPath ||
      authorDoc.officerPhotoPath ||
      authorDoc.instituteLogoPath ||
      '',
  };
}

/**
 * @param {object} comment
 * @param {object | null} author
 */
function serializeComment(comment, author = null) {
  const doc = typeof comment.toObject === 'function' ? comment.toObject() : comment;
  const authorDoc =
    author ||
    (doc.authorId && typeof doc.authorId === 'object' && doc.authorId._id
      ? doc.authorId
      : null);

  return {
    id: String(doc._id),
    postId: String(doc.postId),
    parentCommentId: doc.parentCommentId ? String(doc.parentCommentId) : null,
    content: doc.content,
    media: (doc.media || []).map((item) => ({
      id: String(item._id || ''),
      mediaType: item.mediaType || MEDIA_TYPES.IMAGE,
      url: item.url,
      thumbnail: item.thumbnail || item.url || '',
      duration: item.duration ?? null,
    })),
    depth: doc.depth || 0,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    author: serializeAuthor(authorDoc),
  };
}

/**
 * @param {string} postId
 */
async function requirePublishedPost(postId) {
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
      code: 'POST_NOT_FOUND',
    });
  }

  const post = await Post.findById(postId);
  if (!post || post.status !== POST_STATUS.PUBLISHED) {
    throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
      code: 'POST_NOT_FOUND',
    });
  }
  return post;
}

class FeedEngagementService {
  /**
   * Set / switch / clear reaction (FEED-004).
   * @param {{ user: object, postId: string, reactionType?: string }} input
   */
  async toggleLike({ user, postId, reactionType = 'like' }) {
    const post = await requirePublishedPost(postId);
    const type = String(reactionType || 'like').trim().toLowerCase();
    if (!REACTION_TYPES.includes(type)) {
      throw new AppError('Invalid reaction type', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_REACTION',
      });
    }

    const existing = await Reaction.findOne({
      postId: post._id,
      userId: user._id,
    });

    if (existing && existing.reactionType === type) {
      await existing.deleteOne();
      await Post.updateOne(
        { _id: post._id, 'stats.likes': { $gt: 0 } },
        { $inc: { 'stats.likes': -1 } },
      );
      const fresh = await Post.findById(post._id).lean();
      await refreshTrendingScore(fresh);
      const counts = await this.getReactionCounts(post._id);
      emitFeedEvent({
        event: 'like',
        userId: String(user._id),
        postId: String(post._id),
        meta: { liked: false, reactionType: type },
      });
      return {
        liked: false,
        reactionType: null,
        likes: Object.values(counts).reduce((a, b) => a + b, 0),
        reactionCounts: counts,
      };
    }

    if (existing) {
      existing.reactionType = type;
      await existing.save();
    } else {
      try {
        await Reaction.create({
          postId: post._id,
          userId: user._id,
          reactionType: type,
        });
        await Post.updateOne({ _id: post._id }, { $inc: { 'stats.likes': 1 } });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
      }
    }

    const fresh = await Post.findById(post._id).lean();
    await refreshTrendingScore(fresh);
    const counts = await this.getReactionCounts(post._id);
    emitFeedEvent({
      event: 'like',
      userId: String(user._id),
      postId: String(post._id),
      meta: { liked: true, reactionType: type },
    });
    return {
      liked: true,
      reactionType: type,
      likes: Object.values(counts).reduce((a, b) => a + b, 0),
      reactionCounts: counts,
    };
  }

  /**
   * @param {import('mongoose').Types.ObjectId | string} postId
   */
  async getReactionCounts(postId) {
    const rows = await Reaction.aggregate([
      { $match: { postId: new mongoose.Types.ObjectId(String(postId)) } },
      { $group: { _id: '$reactionType', count: { $sum: 1 } } },
    ]);
    const counts = {};
    for (const row of rows) {
      counts[row._id] = row.count;
    }
    return counts;
  }

  /**
   * @param {{ user: object, postId: string, content?: string, parentCommentId?: string | null, media?: object[] }} input
   */
  async addComment({ user, postId, content, parentCommentId = null, media = [] }) {
    const post = await requirePublishedPost(postId);
    const text = String(content || '').trim();
    const mediaInput = Array.isArray(media) ? media : [];
    const commentMedia = mediaInput
      .map((item) => {
        const mediaType =
          String(item?.mediaType || '').trim() === MEDIA_TYPES.AUDIO
            ? MEDIA_TYPES.AUDIO
            : MEDIA_TYPES.IMAGE;
        return {
          mediaType,
          url: String(item?.url || '').trim(),
          thumbnail: String(item?.thumbnail || '').trim(),
          duration:
            item?.duration != null && Number.isFinite(Number(item.duration))
              ? Number(item.duration)
              : null,
        };
      })
      .filter((item) => item.url.startsWith('/uploads/'))
      .slice(0, FEED_LIMITS.MAX_COMMENT_IMAGES);

    if (!text && commentMedia.length === 0) {
      throw new AppError('Comment cannot be empty', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMPTY_COMMENT',
      });
    }
    if (text.length > FEED_LIMITS.MAX_COMMENT_LENGTH) {
      throw new AppError(
        `Comment cannot exceed ${FEED_LIMITS.MAX_COMMENT_LENGTH} characters`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'COMMENT_TOO_LONG' },
      );
    }

    let depth = 0;
    let parentId = null;
    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        throw new AppError('Parent comment not found', HTTP_STATUS.NOT_FOUND, {
          code: 'PARENT_NOT_FOUND',
        });
      }
      const parent = await Comment.findOne({
        _id: parentCommentId,
        postId: post._id,
        status: 'published',
      });
      if (!parent) {
        throw new AppError('Parent comment not found', HTTP_STATUS.NOT_FOUND, {
          code: 'PARENT_NOT_FOUND',
        });
      }
      depth = (parent.depth || 0) + 1;
      if (depth > FEED_LIMITS.MAX_COMMENT_DEPTH) {
        throw new AppError(
          `Replies are limited to ${FEED_LIMITS.MAX_COMMENT_DEPTH} levels`,
          HTTP_STATUS.BAD_REQUEST,
          { code: 'COMMENT_DEPTH_EXCEEDED' },
        );
      }
      parentId = parent._id;
    }

    const comment = await Comment.create({
      postId: post._id,
      authorId: user._id,
      parentCommentId: parentId,
      content: text,
      media: commentMedia,
      depth,
      status: 'published',
    });

    await Post.updateOne({ _id: post._id }, { $inc: { 'stats.comments': 1 } });
    await refreshTrendingScore(post);
    emitFeedEvent({
      event: 'comment',
      userId: String(user._id),
      postId: String(post._id),
      meta: { hasMedia: commentMedia.length > 0, depth },
    });

    return serializeComment(comment, user);
  }

  /**
   * Flat list of comments for a post (client builds tree).
   * @param {{ postId: string }} input
   */
  async listComments({ postId }) {
    await requirePublishedPost(postId);

    const rows = await Comment.find({
      postId,
      status: 'published',
    })
      .sort({ createdAt: 1, _id: 1 })
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    return {
      items: rows.map((row) => serializeComment(row, row.authorId)),
    };
  }

  /**
   * Normalize collection name; throws if empty after trim.
   * @param {string} name
   */
  #normalizeCollectionName(name) {
    const folder = String(name || '')
      .trim()
      .slice(0, FEED_LIMITS.MAX_BOOKMARK_FOLDER_LENGTH);
    if (!folder) {
      throw new AppError('Collection name is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'COLLECTION_NAME_REQUIRED',
      });
    }
    return folder;
  }

  /**
   * Ensure a named collection row exists for the user.
   * @param {object} user
   * @param {string} name
   */
  async #ensureCollection(user, name) {
    try {
      await BookmarkCollection.updateOne(
        { userId: user._id, name },
        { $setOnInsert: { userId: user._id, name } },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  /**
   * @param {{ user: object, postId: string, folderName?: string }} input
   */
  async toggleBookmark({ user, postId, folderName = '' }) {
    const post = await requirePublishedPost(postId);
    const folder = String(folderName || '')
      .trim()
      .slice(0, FEED_LIMITS.MAX_BOOKMARK_FOLDER_LENGTH);

    const existing = await Bookmark.findOne({
      userId: user._id,
      postId: post._id,
    });

    if (existing) {
      // * Same folder (or empty) → remove. Different folder → move.
      if (!folder || existing.folderName === folder) {
        await existing.deleteOne();
        await Post.updateOne(
          { _id: post._id, 'stats.saves': { $gt: 0 } },
          { $inc: { 'stats.saves': -1 } },
        );
        const fresh = await Post.findById(post._id).lean();
        await refreshTrendingScore(fresh);
        return {
          bookmarked: false,
          folderName: null,
          saves: fresh?.stats?.saves || 0,
        };
      }
      existing.folderName = folder;
      existing.isPrivate = true;
      await existing.save();
      await this.#ensureCollection(user, folder);
      return {
        bookmarked: true,
        folderName: existing.folderName,
        saves: post.stats?.saves || 0,
      };
    }

    if (folder) {
      await this.#ensureCollection(user, folder);
    }

    try {
      await Bookmark.create({
        userId: user._id,
        postId: post._id,
        folderName: folder,
        isPrivate: true,
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }

    await Post.updateOne({ _id: post._id }, { $inc: { 'stats.saves': 1 } });
    const fresh = await Post.findById(post._id).lean();
    await refreshTrendingScore(fresh);
    emitFeedEvent({
      event: 'bookmark',
      userId: String(user._id),
      postId: String(post._id),
      meta: { bookmarked: true, folderName: folder },
    });
    return {
      bookmarked: true,
      folderName: folder,
      saves: fresh?.stats?.saves || 0,
    };
  }

  /**
   * List private Saved collections for the user (named folders + counts).
   */
  async listBookmarkFolders({ user }) {
    const [collections, counts] = await Promise.all([
      BookmarkCollection.find({ userId: user._id }).sort({ name: 1 }).lean(),
      Bookmark.aggregate([
        { $match: { userId: user._id } },
        {
          $group: {
            _id: { $ifNull: ['$folderName', ''] },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const countMap = new Map(
      counts.map((row) => [String(row._id || ''), row.count]),
    );

    const names = new Set();
    for (const row of collections) {
      if (row.name) names.add(row.name);
    }
    for (const [name] of countMap) {
      if (name) names.add(name);
    }

    const items = [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((folderName) => ({
        folderName,
        label: folderName,
        count: countMap.get(folderName) || 0,
      }));

    return { items };
  }

  /**
   * Create an empty Saved collection.
   * @param {{ user: object, name: string }} input
   */
  async createBookmarkFolder({ user, name }) {
    const folder = this.#normalizeCollectionName(name);
    try {
      await BookmarkCollection.create({ userId: user._id, name: folder });
    } catch (error) {
      if (error?.code === 11000) {
        throw new AppError('Collection already exists', HTTP_STATUS.CONFLICT, {
          code: 'COLLECTION_EXISTS',
        });
      }
      throw error;
    }
    return { folderName: folder, label: folder, count: 0 };
  }

  /**
   * Rename a Saved collection (updates collection + bookmarks).
   * @param {{ user: object, from: string, to: string }} input
   */
  async renameBookmarkFolder({ user, from, to }) {
    const oldName = this.#normalizeCollectionName(from);
    const newName = this.#normalizeCollectionName(to);
    if (oldName.toLowerCase() === newName.toLowerCase() && oldName !== newName) {
      // * Case-only rename
    } else if (oldName === newName) {
      return { folderName: newName, label: newName };
    }

    const existingTarget = await BookmarkCollection.findOne({
      userId: user._id,
      name: newName,
    });
    if (existingTarget && oldName.toLowerCase() !== newName.toLowerCase()) {
      throw new AppError('Collection already exists', HTTP_STATUS.CONFLICT, {
        code: 'COLLECTION_EXISTS',
      });
    }

    const source = await BookmarkCollection.findOne({
      userId: user._id,
      name: oldName,
    });
    if (source) {
      source.name = newName;
      await source.save();
    } else {
      await this.#ensureCollection(user, newName);
    }

    await Bookmark.updateMany(
      { userId: user._id, folderName: oldName },
      { $set: { folderName: newName } },
    );

    const count = await Bookmark.countDocuments({
      userId: user._id,
      folderName: newName,
    });
    return { folderName: newName, label: newName, count };
  }

  /**
   * Delete a Saved collection and all bookmarks inside it.
   * @param {{ user: object, name: string }} input
   */
  async deleteBookmarkFolder({ user, name }) {
    const folder = this.#normalizeCollectionName(name);
    const bookmarks = await Bookmark.find({
      userId: user._id,
      folderName: folder,
    }).select('postId');

    const postIds = bookmarks.map((row) => row.postId);
    if (postIds.length) {
      await Bookmark.deleteMany({ userId: user._id, folderName: folder });
      await Post.updateMany(
        { _id: { $in: postIds }, 'stats.saves': { $gt: 0 } },
        { $inc: { 'stats.saves': -1 } },
      );
    }

    await BookmarkCollection.deleteOne({ userId: user._id, name: folder });
    return { folderName: folder, deleted: true, removedSaves: postIds.length };
  }

  /**
   * @param {{ user: object, cursor?: string, limit?: number, folderName?: string }} input
   */
  async listBookmarks({ user, cursor, limit, folderName }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = { userId: user._id };
    if (folderName !== undefined && folderName !== null && folderName !== '') {
      filter.folderName = String(folderName).trim();
    }
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Bookmark.find(filter)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const postIds = page.map((row) => row.postId);

    const posts = await Post.find({
      _id: { $in: postIds },
      status: POST_STATUS.PUBLISHED,
    })
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const postMap = new Map(posts.map((p) => [String(p._id), p]));
    const folderMap = new Map(
      page.map((row) => [String(row.postId), row.folderName || '']),
    );
    const items = page
      .map((row) => {
        const post = postMap.get(String(row.postId));
        if (!post) {
          return null;
        }
        const serialized = serializePost(post, post.authorId);
        serialized.viewerState = {
          liked: false,
          reactionType: null,
          bookmarked: true,
          bookmarkFolder: folderMap.get(String(row.postId)) || '',
          followingAuthor: false,
          pollOptionId: null,
          reported: false,
        };
        return serialized;
      })
      .filter(Boolean);

    if (items.length) {
      const likes = await Reaction.find({
        userId: user._id,
        postId: { $in: items.map((item) => item.id) },
      })
        .select('postId reactionType')
        .lean();
      const likedMap = new Map(
        likes.map((row) => [String(row.postId), row.reactionType]),
      );
      items.forEach((item) => {
        const reactionType = likedMap.get(item.id) || null;
        item.viewerState.liked = Boolean(reactionType);
        item.viewerState.reactionType = reactionType;
      });
    }

    return {
      items,
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  /**
   * @param {{ user: object, postId: string, reason: string, note?: string }} input
   */
  async reportPost({ user, postId, reason, note = '' }) {
    const post = await requirePublishedPost(postId);
    if (String(post.authorId) === String(user._id)) {
      throw new AppError('You cannot report your own post', HTTP_STATUS.BAD_REQUEST, {
        code: 'CANNOT_REPORT_OWN',
      });
    }

    if (!REPORT_REASONS.includes(reason)) {
      throw new AppError('Invalid report reason', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_REASON',
      });
    }

    try {
      await Report.create({
        postId: post._id,
        reporterId: user._id,
        reason,
        note: String(note || '').trim().slice(0, 500),
        status: 'open',
      });
      await Post.updateOne({ _id: post._id }, { $inc: { 'stats.reports': 1 } });
    } catch (error) {
      if (error?.code === 11000) {
        throw new AppError('You already reported this post', HTTP_STATUS.CONFLICT, {
          code: 'ALREADY_REPORTED',
        });
      }
      throw error;
    }

    const openCount = await Report.countDocuments({
      postId: post._id,
      status: 'open',
    });

    let hidden = false;
    if (openCount >= FEED_LIMITS.REPORT_HIDE_THRESHOLD) {
      await Post.updateOne(
        { _id: post._id, status: POST_STATUS.PUBLISHED },
        { $set: { status: POST_STATUS.HIDDEN } },
      );
      hidden = true;
    }

    emitFeedEvent({
      event: 'report_submitted',
      userId: String(user._id),
      postId: String(post._id),
      meta: { reason, hidden, openReports: openCount },
    });

    return { reported: true, openReports: openCount, hidden };
  }

  /**
   * Record share + return outbound links.
   * @param {{ user: object, postId: string }} input
   */
  async sharePost({ user, postId }) {
    const post = await requirePublishedPost(postId);
    await Post.updateOne({ _id: post._id }, { $inc: { 'stats.shares': 1 } });
    await refreshTrendingScore(post._id);

    const publicBase = String(
      config.email?.appPublicUrl || 'http://localhost:5173',
    ).replace(/\/$/, '');
    const url = `${publicBase}/posts/${post._id}`;
    const text = encodeURIComponent(
      (post.content || 'Check this BIGB post').slice(0, 120),
    );
    const encodedUrl = encodeURIComponent(url);

    const fresh = await Post.findById(post._id).lean();

    emitFeedEvent({
      event: 'share',
      userId: String(user._id),
      postId: String(post._id),
    });

    return {
      shares: fresh?.stats?.shares || 0,
      url,
      targets: {
        whatsapp: `https://wa.me/?text=${text}%20${encodedUrl}`,
        telegram: `https://t.me/share/url?url=${encodedUrl}&text=${text}`,
        copy: url,
        qr: url,
      },
      sharedBy: String(user._id),
    };
  }

  /**
   * Toggle follow another user.
   * @param {{ user: object, targetUserId: string }} input
   */
  async toggleFollow({ user, targetUserId }) {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    if (String(user._id) === String(targetUserId)) {
      throw new AppError('You cannot follow yourself', HTTP_STATUS.BAD_REQUEST, {
        code: 'CANNOT_FOLLOW_SELF',
      });
    }

    const { User } = require('../auth/user.model');
    const target = await User.findById(targetUserId).select('_id');
    if (!target) {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    const existing = await Follow.findOne({
      followerId: user._id,
      followingId: target._id,
    });

    if (existing) {
      await existing.deleteOne();
      return { following: false };
    }

    try {
      await Follow.create({
        followerId: user._id,
        followingId: target._id,
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }

    return { following: true };
  }
}

const feedEngagementService = new FeedEngagementService();

module.exports = {
  feedEngagementService,
  serializeComment,
};
