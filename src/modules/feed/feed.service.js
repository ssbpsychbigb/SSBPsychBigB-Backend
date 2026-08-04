'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Post } = require('./post.model');
const { Reaction } = require('./reaction.model');
const { Bookmark } = require('./bookmark.model');
const { Follow } = require('./follow.model');
const { PollVote } = require('./poll-vote.model');
const { Comment } = require('./comment.model');
const { Report } = require('./report.model');
const { User } = require('../auth/user.model');
const {
  POST_TYPES,
  POST_STATUS,
  POST_VISIBILITY,
  MEDIA_TYPES,
  POST_CATEGORIES,
  FEED_LIMITS,
  REACTION_TYPES,
  PHASE_C_POST_TYPES,
  PHASE_D_POST_TYPES,
  REPORT_REASONS,
  POLL_DURATIONS,
  ACHIEVEMENT_KINDS,
  STUDY_MODE_CATEGORIES,
  PIN_LIMITS,
} = require('./feed.constants');
const { toFeedPublicPath, detectMediaType } = require('./feed.upload');
const { computeTrendingScore } = require('./feed-score');
const { refreshTrendingScore } = require('./feed-score');
const { emitFeedEvent } = require('./feed-analytics');

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractHashtags(text) {
  const matches = String(text || '').match(/#[a-zA-Z0-9_]+/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1).toLowerCase()))];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractMentions(text) {
  const matches = String(text || '').match(/@([a-zA-Z0-9_]{2,40})/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1).toLowerCase()))];
}

/**
 * @param {object} body
 */
function buildPollFromBody(body) {
  const rawOptions = Array.isArray(body.poll?.options)
    ? body.poll.options
    : Array.isArray(body.pollOptions)
      ? body.pollOptions
      : [];
  const options = rawOptions
    .map((item) => String(typeof item === 'string' ? item : item?.text || '').trim())
    .filter(Boolean)
    .slice(0, FEED_LIMITS.MAX_POLL_OPTIONS);

  if (options.length < FEED_LIMITS.MIN_POLL_OPTIONS) {
    throw new AppError(
      `Polls need at least ${FEED_LIMITS.MIN_POLL_OPTIONS} options`,
      HTTP_STATUS.BAD_REQUEST,
      { code: 'POLL_OPTIONS' },
    );
  }

  const duration = Object.prototype.hasOwnProperty.call(
    POLL_DURATIONS,
    body.poll?.duration || body.pollDuration,
  )
    ? body.poll?.duration || body.pollDuration
    : '7d';
  const days = POLL_DURATIONS[duration];
  const endsAt =
    days == null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  return {
    options: options.map((text) => ({ text, votes: 0 })),
    duration,
    endsAt,
  };
}

/**
 * @param {object} body
 */
function buildAchievementFromBody(body) {
  const raw = body.achievement || {};
  const kind = ACHIEVEMENT_KINDS.includes(raw.kind) ? raw.kind : 'other';
  const verificationStatus =
    kind === 'recommended' ? 'pending' : 'none';

  return {
    kind,
    board: String(raw.board || '').trim().slice(0, 120),
    date: raw.date ? new Date(raw.date) : null,
    note: String(raw.note || '').trim().slice(0, 500),
    verificationStatus,
  };
}

/**
 * @param {object} body
 */
function buildQuestionFromBody(body) {
  return {
    isAskMentor: Boolean(body.question?.isAskMentor ?? body.isAskMentor),
    acceptedAnswerId: null,
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCategories(value) {
  const list = Array.isArray(value) ? value : [];
  const allowed = new Set(POST_CATEGORIES);
  return [
    ...new Set(
      list
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => allowed.has(item)),
    ),
  ];
}

/**
 * @param {import('mongoose').Document | object} post
 * @param {object | null} author
 * @returns {object}
 */
function serializePost(post, author = null, viewerState = null) {
  const doc = typeof post.toObject === 'function' ? post.toObject() : post;
  const authorDoc =
    author ||
    (doc.authorId && typeof doc.authorId === 'object' && doc.authorId._id
      ? doc.authorId
      : null);

  return {
    id: String(doc._id),
    authorId: String(authorDoc?._id || doc.authorId),
    type: doc.type,
    content: doc.content || '',
    visibility: doc.visibility,
    categories: doc.categories || [],
    educationalScore: doc.educationalScore ?? 0,
    status: doc.status,
    media: (doc.media || []).map((item) => ({
      id: String(item._id || ''),
      mediaType: item.mediaType,
      url: item.url,
      thumbnail: item.thumbnail || '',
      width: item.width,
      height: item.height,
      duration: item.duration,
    })),
    hashtags: doc.hashtags || [],
    mentions: (doc.mentions || []).map((id) => String(id)),
    poll: doc.poll
      ? {
          duration: doc.poll.duration,
          endsAt: doc.poll.endsAt || null,
          options: (doc.poll.options || []).map((opt) => ({
            id: String(opt._id || opt.id || ''),
            text: opt.text,
            votes: opt.votes || 0,
          })),
        }
      : null,
    question: doc.question
      ? {
          isAskMentor: Boolean(doc.question.isAskMentor),
          acceptedAnswerId: doc.question.acceptedAnswerId
            ? String(doc.question.acceptedAnswerId)
            : null,
        }
      : null,
    achievement: doc.achievement
      ? {
          kind: doc.achievement.kind || 'other',
          board: doc.achievement.board || '',
          date: doc.achievement.date || null,
          note: doc.achievement.note || '',
          verificationStatus: doc.achievement.verificationStatus || 'none',
        }
      : null,
    stats: {
      likes: doc.stats?.likes || 0,
      comments: doc.stats?.comments || 0,
      shares: doc.stats?.shares || 0,
      saves: doc.stats?.saves || 0,
      reports: doc.stats?.reports || 0,
    },
    trendingScore: doc.trendingScore || 0,
    pinnedAt: doc.pinnedAt || null,
    editedAt: doc.editedAt || null,
    deletedAt: doc.deletedAt || null,
    communityId: doc.communityId ? String(doc.communityId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    /** Blur reported content for non-authors (FEED-012 Facebook-like). */
    isReported: (doc.stats?.reports || 0) > 0 || doc.status === POST_STATUS.HIDDEN,
    reportCount: doc.stats?.reports || 0,
    reactionCounts: doc.reactionCounts || null,
    author: authorDoc
      ? {
          id: String(authorDoc._id),
          fullName: authorDoc.fullName || '',
          role: authorDoc.role,
          verificationLevel: authorDoc.verificationLevel ?? 0,
          profilePhotoPath:
            authorDoc.profilePhotoPath ||
            authorDoc.officerPhotoPath ||
            authorDoc.instituteLogoPath ||
            '',
        }
      : null,
    viewerState: viewerState || {
      liked: false,
      reactionType: null,
      bookmarked: false,
      bookmarkFolder: null,
      followingAuthor: false,
      pollOptionId: null,
      reported: false,
    },
  };
}

/**
 * @param {string | undefined} cursor
 * @returns {{ createdAt: Date, id: mongoose.Types.ObjectId } | null}
 */
function parseCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') {
    return null;
  }
  const [iso, id] = cursor.split('__');
  if (!iso || !id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return { createdAt, id: new mongoose.Types.ObjectId(id) };
}

/**
 * @param {object} post
 * @returns {string}
 */
function makeCursor(post) {
  return `${new Date(post.createdAt).toISOString()}__${String(post._id)}`;
}

/**
 * Visibility filter for a viewer (guest or authenticated).
 * @param {string | null} viewerId
 * @param {mongoose.Types.ObjectId[]} followingIds
 */
function visibilityFilter(viewerId, followingIds = []) {
  if (!viewerId) {
    return { visibility: POST_VISIBILITY.PUBLIC };
  }

  const viewerObjectId = new mongoose.Types.ObjectId(viewerId);
  const or = [
    { visibility: POST_VISIBILITY.PUBLIC },
    { authorId: viewerObjectId },
  ];

  if (followingIds.length) {
    or.push({
      visibility: POST_VISIBILITY.FOLLOWERS,
      authorId: { $in: followingIds },
    });
  }

  return { $or: or };
}

/**
 * @param {string | null} viewerId
 * @returns {Promise<mongoose.Types.ObjectId[]>}
 */
async function loadFollowingIds(viewerId) {
  if (!viewerId) {
    return [];
  }
  const rows = await Follow.find({ followerId: viewerId })
    .select('followingId')
    .lean();
  return rows.map((row) => row.followingId);
}

/**
 * @param {object[]} items serialized posts
 * @param {string | null} viewerId
 */
async function attachViewerStates(items, viewerId) {
  if (!items.length) {
    return items;
  }

  const postIds = items.map((item) => item.id);
  const authorIds = [...new Set(items.map((item) => item.authorId))];

  // * Reaction breakdown for all posts in page (public counts).
  const reactionRows = await Reaction.find({ postId: { $in: postIds } })
    .select('postId userId reactionType')
    .lean();

  const countsByPost = new Map();
  for (const row of reactionRows) {
    const pid = String(row.postId);
    const bucket = countsByPost.get(pid) || {};
    bucket[row.reactionType] = (bucket[row.reactionType] || 0) + 1;
    countsByPost.set(pid, bucket);
  }
  items.forEach((item) => {
    item.reactionCounts = countsByPost.get(item.id) || {};
    item.stats.likes = Object.values(item.reactionCounts).reduce(
      (sum, n) => sum + n,
      0,
    );
  });

  if (!viewerId) {
    return items;
  }

  const [bookmarks, follows, pollVotes, myReports] = await Promise.all([
    Bookmark.find({ userId: viewerId, postId: { $in: postIds } })
      .select('postId folderName')
      .lean(),
    Follow.find({
      followerId: viewerId,
      followingId: { $in: authorIds },
    })
      .select('followingId')
      .lean(),
    PollVote.find({ userId: viewerId, postId: { $in: postIds } })
      .select('postId optionId')
      .lean(),
    Report.find({ reporterId: viewerId, postId: { $in: postIds }, status: 'open' })
      .select('postId')
      .lean(),
  ]);

  const myReactionMap = new Map();
  for (const row of reactionRows) {
    if (String(row.userId) === String(viewerId)) {
      myReactionMap.set(String(row.postId), row.reactionType);
    }
  }

  const bookmarkMap = new Map(
    bookmarks.map((row) => [String(row.postId), row.folderName || '']),
  );
  const followingSet = new Set(follows.map((row) => String(row.followingId)));
  const pollVoteMap = new Map(
    pollVotes.map((row) => [String(row.postId), String(row.optionId)]),
  );
  const reportedSet = new Set(myReports.map((row) => String(row.postId)));

  items.forEach((item) => {
    const reactionType = myReactionMap.get(item.id) || null;
    item.viewerState = {
      liked: Boolean(reactionType),
      reactionType,
      bookmarked: bookmarkMap.has(item.id),
      bookmarkFolder: bookmarkMap.has(item.id)
        ? bookmarkMap.get(item.id) || ''
        : null,
      followingAuthor: followingSet.has(item.authorId),
      pollOptionId: pollVoteMap.get(item.id) || null,
      reported: reportedSet.has(item.id),
    };
  });

  return items;
}

/**
 * Attach up to 2 root comments per post (feed preview — one batch query).
 * @param {object[]} items
 */
async function attachCommentPreviews(items) {
  if (!items.length) {
    return items;
  }

  const postIds = items.map((item) => item.id);
  const rows = await Comment.find({
    postId: { $in: postIds },
    parentCommentId: null,
    status: 'published',
  })
    .sort({ createdAt: 1, _id: 1 })
    .populate(
      'authorId',
      'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
    )
    .lean();

  const { serializeComment } = require('./feed-engagement.service');
  const byPost = new Map();
  for (const row of rows) {
    const key = String(row.postId);
    const list = byPost.get(key) || [];
    if (list.length >= 2) continue;
    list.push(serializeComment(row, row.authorId));
    byPost.set(key, list);
  }

  items.forEach((item) => {
    item.commentPreview = byPost.get(item.id) || [];
  });

  return items;
}

/**
 * Shared cursor feed query.
 */
async function queryFeedPage({ filter, cursor, limit, viewerId }) {
  const pageSize = Math.min(
    Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
    FEED_LIMITS.MAX_PAGE_SIZE,
  );

  const query = { ...filter };
  const parsed = parseCursor(cursor);
  if (parsed) {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { createdAt: { $lt: parsed.createdAt } },
          {
            createdAt: parsed.createdAt,
            _id: { $lt: parsed.id },
          },
        ],
      },
    ];
  }

  const rows = await Post.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .populate(
      'authorId',
      'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
    )
    .lean();

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  let items = page.map((row) => serializePost(row, row.authorId));
  items = await attachViewerStates(items, viewerId);
  items = await attachCommentPreviews(items);
  const nextCursor = hasMore && page.length ? makeCursor(page[page.length - 1]) : null;

  return { items, nextCursor, hasMore };
}

class FeedService {
  /**
   * Upload feed images/videos → public media descriptors.
   * @param {{ files: Express.Multer.File[] }} input
   */
  uploadMedia({ files }) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      throw new AppError('At least one media file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'MEDIA_REQUIRED',
      });
    }

    return {
      media: list
        .map((file) => {
          const url = toFeedPublicPath(file);
          if (!url) {
            return null;
          }
          const mediaType = detectMediaType(file);
          return {
            mediaType,
            url,
            thumbnail: mediaType === MEDIA_TYPES.IMAGE ? url : '',
            duration: null,
          };
        })
        .filter(Boolean),
    };
  }

  /**
   * Normalize + validate media payload from create/update.
   * @param {unknown[]} mediaInput
   */
  normalizeMediaInput(mediaInput) {
    const list = Array.isArray(mediaInput) ? mediaInput : [];
    if (list.length > FEED_LIMITS.MAX_IMAGES) {
      throw new AppError(
        `You can attach at most ${FEED_LIMITS.MAX_IMAGES} media items`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'TOO_MANY_IMAGES' },
      );
    }

    const media = list
      .map((item) => {
        const url = String(item?.url || '').trim();
        if (!url.startsWith('/uploads/')) {
          return null;
        }
        const rawType = String(item?.mediaType || MEDIA_TYPES.IMAGE).trim();
        const mediaType =
          rawType === MEDIA_TYPES.VIDEO ? MEDIA_TYPES.VIDEO : MEDIA_TYPES.IMAGE;
        let duration = null;
        if (mediaType === MEDIA_TYPES.VIDEO && item?.duration != null) {
          duration = Number(item.duration);
          if (!Number.isFinite(duration) || duration < 0) {
            duration = null;
          }
          if (
            duration != null &&
            duration > FEED_LIMITS.MAX_VIDEO_DURATION_SEC
          ) {
            throw new AppError(
              `Videos cannot exceed ${FEED_LIMITS.MAX_VIDEO_DURATION_SEC / 60} minutes`,
              HTTP_STATUS.BAD_REQUEST,
              { code: 'VIDEO_TOO_LONG' },
            );
          }
        }
        return {
          mediaType,
          url,
          thumbnail: String(item?.thumbnail || (mediaType === MEDIA_TYPES.IMAGE ? url : '')).trim(),
          duration,
        };
      })
      .filter(Boolean);

    const videos = media.filter((m) => m.mediaType === MEDIA_TYPES.VIDEO);
    const images = media.filter((m) => m.mediaType === MEDIA_TYPES.IMAGE);

    if (videos.length > FEED_LIMITS.MAX_VIDEOS) {
      throw new AppError(
        `You can attach at most ${FEED_LIMITS.MAX_VIDEOS} video`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'TOO_MANY_VIDEOS' },
      );
    }
    if (videos.length && images.length) {
      throw new AppError(
        'Mix of images and video is not supported',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'MIXED_MEDIA_NOT_ALLOWED' },
      );
    }

    return media;
  }

  /**
   * Create a published or draft post (Phase A: text / image).
   * @param {{ author: object, body: object }} input
   */
  async createPost({ author, body }) {
    const content = String(body.content || '').trim();
    const status =
      body.status === POST_STATUS.DRAFT
        ? POST_STATUS.DRAFT
        : POST_STATUS.PUBLISHED;
    const visibility = Object.values(POST_VISIBILITY).includes(body.visibility)
      ? body.visibility
      : POST_VISIBILITY.PUBLIC;

    if (content.length > FEED_LIMITS.MAX_TEXT_LENGTH) {
      throw new AppError(
        `Post text cannot exceed ${FEED_LIMITS.MAX_TEXT_LENGTH} characters`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CONTENT_TOO_LONG' },
      );
    }

    const media = this.normalizeMediaInput(body.media);
    const hasVideo = media.some((item) => item.mediaType === MEDIA_TYPES.VIDEO);

    let type = String(body.type || '').trim();
    if (!type) {
      if (body.poll || body.pollOptions) type = POST_TYPES.POLL;
      else if (body.achievement || body.type === 'achievement') type = POST_TYPES.ACHIEVEMENT;
      else if (body.isAskMentor || body.question) type = POST_TYPES.QUESTION;
      else if (hasVideo) type = POST_TYPES.VIDEO;
      else type = media.length ? POST_TYPES.IMAGE : POST_TYPES.TEXT;
    }

    if (!PHASE_D_POST_TYPES.includes(type)) {
      throw new AppError(
        'Unsupported post type for this phase',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'UNSUPPORTED_POST_TYPE' },
      );
    }

    if (type === POST_TYPES.IMAGE && media.length === 0 && status === POST_STATUS.PUBLISHED) {
      throw new AppError(
        'Image posts require at least one uploaded image',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'MEDIA_REQUIRED' },
      );
    }

    if (type === POST_TYPES.VIDEO) {
      if (!hasVideo && status === POST_STATUS.PUBLISHED) {
        throw new AppError(
          'Video posts require an uploaded video',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'MEDIA_REQUIRED' },
        );
      }
    }

    if (
      type === POST_TYPES.TEXT &&
      !content &&
      media.length === 0 &&
      status === POST_STATUS.PUBLISHED
    ) {
      throw new AppError(
        'Add text or at least one image to create a post',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMPTY_POST' },
      );
    }

    const categories = normalizeCategories(body.categories);
    if (status === POST_STATUS.PUBLISHED && categories.length === 0) {
      throw new AppError(
        'Select at least one category before publishing',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CATEGORY_REQUIRED' },
      );
    }

    let poll = null;
    let question = null;
    let achievement = null;

    if (type === POST_TYPES.POLL) {
      poll = buildPollFromBody(body);
      if (!content) {
        // * Allow poll with empty caption.
      }
    }
    if (type === POST_TYPES.QUESTION) {
      if (!content) {
        throw new AppError('Question text is required', HTTP_STATUS.BAD_REQUEST, {
          code: 'EMPTY_QUESTION',
        });
      }
      question = buildQuestionFromBody(body);
    }
    if (type === POST_TYPES.ACHIEVEMENT) {
      achievement = buildAchievementFromBody(body);
      if (!content && !achievement.note) {
        throw new AppError(
          'Add a short story for your achievement',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EMPTY_ACHIEVEMENT' },
        );
      }
    }

    const mentionIds = Array.isArray(body.mentionIds)
      ? body.mentionIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];

    const post = await Post.create({
      authorId: author._id,
      type,
      content,
      visibility,
      categories,
      status,
      media,
      poll,
      question,
      achievement,
      hashtags: extractHashtags(content),
      mentions: mentionIds,
      educationalScore: 0,
      trendingScore: 0,
    });

    if (status === POST_STATUS.PUBLISHED) {
      await refreshTrendingScore(post.toObject());
      emitFeedEvent({
        event: 'post_created',
        userId: String(author._id),
        postId: String(post._id),
        meta: { type, categories },
      });
      const fresh = await Post.findById(post._id);
      return serializePost(fresh, author);
    }

    return serializePost(post, author);
  }

  /**
   * @param {{ author: object, postId: string, body: object }} input
   */
  async updatePost({ author, postId, body }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (!post || post.status === POST_STATUS.DELETED) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    if (String(post.authorId) !== String(author._id)) {
      throw new AppError('You can only edit your own posts', HTTP_STATUS.FORBIDDEN, {
        code: 'NOT_POST_OWNER',
      });
    }

    if (body.content !== undefined) {
      const content = String(body.content || '').trim();
      if (content.length > FEED_LIMITS.MAX_TEXT_LENGTH) {
        throw new AppError(
          `Post text cannot exceed ${FEED_LIMITS.MAX_TEXT_LENGTH} characters`,
          HTTP_STATUS.BAD_REQUEST,
          { code: 'CONTENT_TOO_LONG' },
        );
      }
      post.content = content;
      post.hashtags = extractHashtags(content);
    }

    if (body.visibility !== undefined) {
      if (!Object.values(POST_VISIBILITY).includes(body.visibility)) {
        throw new AppError('Invalid visibility', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_VISIBILITY',
        });
      }
      post.visibility = body.visibility;
    }

    if (body.categories !== undefined) {
      const categories = normalizeCategories(body.categories);
      if (post.status === POST_STATUS.PUBLISHED && categories.length === 0) {
        throw new AppError(
          'Select at least one category',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'CATEGORY_REQUIRED' },
        );
      }
      post.categories = categories;
    }

    if (body.media !== undefined) {
      post.media = this.normalizeMediaInput(body.media);
      const richTypes = [
        POST_TYPES.POLL,
        POST_TYPES.QUESTION,
        POST_TYPES.ACHIEVEMENT,
      ];
      if (!richTypes.includes(post.type) && body.type === undefined) {
        const hasVideo = post.media.some(
          (item) => item.mediaType === MEDIA_TYPES.VIDEO,
        );
        if (hasVideo) {
          post.type = POST_TYPES.VIDEO;
        } else if (post.media.length > 0) {
          post.type = POST_TYPES.IMAGE;
        } else if (post.type === POST_TYPES.IMAGE || post.type === POST_TYPES.VIDEO) {
          if (!post.content) {
            throw new AppError(
              'Media posts require at least one file or text',
              HTTP_STATUS.BAD_REQUEST,
              { code: 'EMPTY_POST' },
            );
          }
          post.type = POST_TYPES.TEXT;
        }
      }
    }

    if (body.type !== undefined) {
      const nextType = String(body.type || '').trim();
      if (PHASE_D_POST_TYPES.includes(nextType)) {
        post.type = nextType;
      }
    }

    if (body.poll !== undefined || body.pollOptions !== undefined) {
      if (post.type === POST_TYPES.POLL) {
        post.poll = buildPollFromBody(body);
      }
    }

    if (body.question !== undefined || body.isAskMentor !== undefined) {
      if (post.type === POST_TYPES.QUESTION) {
        const prevAccepted = post.question?.acceptedAnswerId || null;
        post.question = buildQuestionFromBody(body);
        post.question.acceptedAnswerId = prevAccepted;
      }
    }

    if (body.achievement !== undefined) {
      if (post.type === POST_TYPES.ACHIEVEMENT) {
        const prevStatus = post.achievement?.verificationStatus || 'none';
        const next = buildAchievementFromBody(body);
        // * Keep admin verification unless kind changes away from / onto recommended.
        if (next.kind === 'recommended' && prevStatus === 'verified') {
          next.verificationStatus = 'verified';
        } else if (next.kind === 'recommended' && prevStatus === 'rejected') {
          next.verificationStatus = 'pending';
        } else if (next.kind !== 'recommended') {
          next.verificationStatus = 'none';
        }
        post.achievement = next;
      }
    }

    if (body.mentionIds !== undefined) {
      post.mentions = Array.isArray(body.mentionIds)
        ? body.mentionIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
        : [];
    }

    if (body.status !== undefined) {
      const nextStatus = String(body.status || '').trim();
      if (
        nextStatus === POST_STATUS.DRAFT ||
        nextStatus === POST_STATUS.PUBLISHED
      ) {
        if (
          nextStatus === POST_STATUS.PUBLISHED &&
          (!post.categories || post.categories.length === 0)
        ) {
          throw new AppError(
            'Select at least one category before publishing',
            HTTP_STATUS.BAD_REQUEST,
            { code: 'CATEGORY_REQUIRED' },
          );
        }
        post.status = nextStatus;
      }
    }

    const isEmpty =
      !post.content &&
      (!post.media || post.media.length === 0) &&
      post.type !== POST_TYPES.POLL &&
      post.type !== POST_TYPES.ACHIEVEMENT;

    if (isEmpty && post.status === POST_STATUS.PUBLISHED) {
      throw new AppError(
        'Post cannot be empty',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EMPTY_POST' },
      );
    }

    post.editedAt = new Date();
    await post.save();

    if (post.status === POST_STATUS.PUBLISHED) {
      await refreshTrendingScore(post.toObject());
      emitFeedEvent({
        event: 'post_created',
        userId: String(author._id),
        postId: String(post._id),
        meta: { type: post.type, categories: post.categories, via: 'update' },
      });
    }

    const fresh = await Post.findById(post._id);
    return serializePost(fresh, author);
  }

  /**
   * Soft-delete own post (FEED-003). Recoverable for SOFT_DELETE_RECOVERY_DAYS.
   * @param {{ author: object, postId: string }} input
   */
  async deletePost({ author, postId }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (!post || post.status === POST_STATUS.DELETED) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    if (String(post.authorId) !== String(author._id)) {
      throw new AppError(
        'You can only delete your own posts',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_POST_OWNER' },
      );
    }

    post.status = POST_STATUS.DELETED;
    post.deletedAt = new Date();
    post.pinnedAt = null;
    await post.save();

    return {
      id: String(post._id),
      status: post.status,
      deletedAt: post.deletedAt,
      recoverableUntil: new Date(
        post.deletedAt.getTime() +
          FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS * 24 * 60 * 60 * 1000,
      ),
    };
  }

  /**
   * Restore a soft-deleted post within the recovery window.
   */
  async restorePost({ author, postId }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (!post || post.status !== POST_STATUS.DELETED) {
      throw new AppError('Deleted post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }
    if (String(post.authorId) !== String(author._id)) {
      throw new AppError('You can only restore your own posts', HTTP_STATUS.FORBIDDEN, {
        code: 'NOT_POST_OWNER',
      });
    }

    const deletedAt = post.deletedAt ? new Date(post.deletedAt).getTime() : 0;
    const deadline =
      deletedAt + FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS * 24 * 60 * 60 * 1000;
    if (!deletedAt || Date.now() > deadline) {
      throw new AppError(
        'Recovery window has expired. Ask a super admin for permanent cleanup only.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'RECOVERY_EXPIRED' },
      );
    }

    post.status = POST_STATUS.PUBLISHED;
    post.deletedAt = null;
    await post.save();
    await refreshTrendingScore(post.toObject());

    return serializePost(post, author);
  }

  /**
   * Author trash — soft-deleted posts still in recovery window.
   */
  async listTrash({ user, cursor, limit }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );
    const cutoff = new Date(
      Date.now() - FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS * 24 * 60 * 60 * 1000,
    );

    const filter = {
      authorId: user._id,
      status: POST_STATUS.DELETED,
      deletedAt: { $gte: cutoff },
    };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ deletedAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      items: page.map((row) => serializePost(row, row.authorId)),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
      recoveryDays: FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS,
    };
  }

  /**
   * Super admin — all soft-deleted posts (recovery + permanent delete queue).
   */
  async listAdminTrash({ cursor, limit }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = { status: POST_STATUS.DELETED };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ deletedAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const recoveryMs = FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS * 24 * 60 * 60 * 1000;

    return {
      items: page.map((row) => {
        const serialized = serializePost(row, row.authorId);
        const deletedAt = row.deletedAt ? new Date(row.deletedAt).getTime() : 0;
        const remainingMs = deletedAt ? deletedAt + recoveryMs - Date.now() : 0;
        serialized.recoveryDaysLeft = Math.max(
          0,
          Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
        );
        serialized.recoverable = remainingMs > 0;
        return serialized;
      }),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
      recoveryDays: FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS,
    };
  }

  /**
   * Admin restore any soft-deleted post (within or after window — still in DB).
   */
  async adminRestorePost({ postId }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (!post || post.status !== POST_STATUS.DELETED) {
      throw new AppError('Deleted post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    post.status = POST_STATUS.PUBLISHED;
    post.deletedAt = null;
    await post.save();
    await refreshTrendingScore(post.toObject());

    const fresh = await Post.findById(post._id).populate(
      'authorId',
      'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
    );
    return serializePost(fresh, fresh.authorId);
  }

  /**
   * Super admin — permanently remove a soft-deleted (or any) post.
   */
  async permanentDeletePost({ postId }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId);
    if (!post) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    await Promise.all([
      Reaction.deleteMany({ postId: post._id }),
      Bookmark.deleteMany({ postId: post._id }),
      Comment.deleteMany({ postId: post._id }),
      Report.deleteMany({ postId: post._id }),
      PollVote.deleteMany({ postId: post._id }),
    ]);
    await post.deleteOne();

    return { id: String(postId), permanent: true };
  }

  /**
   * Admin — reported posts with open report counts.
   */
  async listReportedPosts({ cursor, limit }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = {
      status: { $in: [POST_STATUS.PUBLISHED, POST_STATUS.HIDDEN] },
      'stats.reports': { $gte: 1 },
    };
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ 'stats.reports': -1, _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const postIds = page.map((row) => row._id);

    const openReports = await Report.find({
      postId: { $in: postIds },
      status: 'open',
    })
      .select('postId reason createdAt')
      .lean();

    const byPost = new Map();
    for (const row of openReports) {
      const key = String(row.postId);
      const list = byPost.get(key) || [];
      list.push({ reason: row.reason, createdAt: row.createdAt });
      byPost.set(key, list);
    }

    return {
      items: page.map((row) => {
        const serialized = serializePost(row, row.authorId);
        serialized.openReports = byPost.get(String(row._id)) || [];
        serialized.openReportCount = serialized.openReports.length;
        return serialized;
      }),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  /**
   * Latest feed (cursor pagination).
   * @param {{ viewerId?: string | null, cursor?: string, limit?: number }} input
   */
  async getLatestFeed({ viewerId = null, cursor, limit }) {
    const followingIds = await loadFollowingIds(viewerId);
    const page = await queryFeedPage({
      filter: {
        status: POST_STATUS.PUBLISHED,
        ...visibilityFilter(viewerId, followingIds),
      },
      cursor,
      limit,
      viewerId,
    });
    emitFeedEvent({
      event: cursor ? 'feed_refresh' : 'feed_viewed',
      userId: viewerId,
      meta: { tab: 'latest', itemCount: page.items?.length || 0 },
    });
    return page;
  }

  /**
   * Following feed — posts from followed authors.
   * @param {{ viewerId: string, cursor?: string, limit?: number }} input
   */
  async getFollowingFeed({ viewerId, cursor, limit }) {
    const followingIds = await loadFollowingIds(viewerId);
    if (!followingIds.length) {
      emitFeedEvent({
        event: cursor ? 'feed_refresh' : 'feed_viewed',
        userId: viewerId,
        meta: { tab: 'following', itemCount: 0 },
      });
      return { items: [], nextCursor: null, hasMore: false };
    }

    const page = await queryFeedPage({
      filter: {
        status: POST_STATUS.PUBLISHED,
        authorId: { $in: followingIds },
        ...visibilityFilter(viewerId, followingIds),
      },
      cursor,
      limit,
      viewerId,
    });

    emitFeedEvent({
      event: cursor ? 'feed_refresh' : 'feed_viewed',
      userId: viewerId,
      meta: { tab: 'following', itemCount: page.items?.length || 0 },
    });

    return page;
  }

  /**
   * Trending feed — rule-based score (no AI).
   */
  async getTrendingFeed({ viewerId = null, cursor, limit }) {
    const followingIds = await loadFollowingIds(viewerId);
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = {
      status: POST_STATUS.PUBLISHED,
      ...visibilityFilter(viewerId, followingIds),
    };

    // * Optional score cursor: score__createdAt__id
    let scoreCursor = null;
    if (cursor && typeof cursor === 'string' && cursor.includes('__')) {
      const [scorePart, iso, id] = cursor.split('__');
      if (iso && id && mongoose.Types.ObjectId.isValid(id)) {
        scoreCursor = {
          score: Number(scorePart),
          createdAt: new Date(iso),
          id: new mongoose.Types.ObjectId(id),
        };
      }
    }

    if (scoreCursor && !Number.isNaN(scoreCursor.score)) {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { trendingScore: { $lt: scoreCursor.score } },
            {
              trendingScore: scoreCursor.score,
              createdAt: { $lt: scoreCursor.createdAt },
            },
            {
              trendingScore: scoreCursor.score,
              createdAt: scoreCursor.createdAt,
              _id: { $lt: scoreCursor.id },
            },
          ],
        },
      ];
    }

    const rows = await Post.find(filter)
      .sort({ trendingScore: -1, createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    let items = page.map((row) => serializePost(row, row.authorId));
    items = await attachViewerStates(items, viewerId);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.trendingScore || 0}__${new Date(last.createdAt).toISOString()}__${String(last._id)}`
        : null;

    emitFeedEvent({
      event: cursor ? 'feed_refresh' : 'feed_viewed',
      userId: viewerId,
      meta: { tab: 'trending', itemCount: items.length },
    });

    return { items, nextCursor, hasMore };
  }

  /**
   * Single post detail.
   * @param {{ postId: string, viewerId?: string | null }} input
   */
  async getPostById({ postId, viewerId = null }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const post = await Post.findById(postId)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    if (!post || post.status === POST_STATUS.DELETED) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    if (post.status === POST_STATUS.HIDDEN) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    if (post.status === POST_STATUS.DRAFT) {
      if (!viewerId || String(post.authorId?._id || post.authorId) !== String(viewerId)) {
        throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
          code: 'POST_NOT_FOUND',
        });
      }
    }

    const authorId = String(post.authorId?._id || post.authorId);
    const isOwner = viewerId && authorId === String(viewerId);
    const followingIds = await loadFollowingIds(viewerId);
    const followsAuthor = followingIds.some((id) => String(id) === authorId);

    if (post.visibility === POST_VISIBILITY.ONLY_ME && !isOwner) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    if (
      post.visibility === POST_VISIBILITY.FOLLOWERS &&
      !isOwner &&
      !followsAuthor
    ) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    const [item] = await attachViewerStates(
      [serializePost(post, post.authorId)],
      viewerId,
    );
    emitFeedEvent({
      event: 'post_viewed',
      userId: viewerId,
      postId: String(post._id),
      meta: { type: post.type },
    });
    return item;
  }

  /**
   * Catalog helpers for composer UI.
   */
  getMeta() {
    return {
      categories: POST_CATEGORIES.map((value) => ({
        value,
        label: value
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
      })),
      studyModeCategories: STUDY_MODE_CATEGORIES,
      limits: {
        maxTextLength: FEED_LIMITS.MAX_TEXT_LENGTH,
        maxImages: FEED_LIMITS.MAX_IMAGES,
        maxVideos: FEED_LIMITS.MAX_VIDEOS,
        maxVideoDurationSec: FEED_LIMITS.MAX_VIDEO_DURATION_SEC,
        maxCommentLength: FEED_LIMITS.MAX_COMMENT_LENGTH,
        maxCommentDepth: FEED_LIMITS.MAX_COMMENT_DEPTH,
        maxCommentImages: FEED_LIMITS.MAX_COMMENT_IMAGES,
        maxPollOptions: FEED_LIMITS.MAX_POLL_OPTIONS,
        minPollOptions: FEED_LIMITS.MIN_POLL_OPTIONS,
      },
      phaseCTypes: PHASE_C_POST_TYPES,
      phaseDTypes: PHASE_D_POST_TYPES,
      reactionTypes: REACTION_TYPES,
      softDeleteRecoveryDays: FEED_LIMITS.SOFT_DELETE_RECOVERY_DAYS,
      visibilities: Object.values(POST_VISIBILITY),
      pollDurations: Object.keys(POLL_DURATIONS),
      achievementKinds: ACHIEVEMENT_KINDS,
      pinLimits: PIN_LIMITS,
      reportReasons: REPORT_REASONS.map((value) => ({
        value,
        label: value
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
      })),
    };
  }

  /**
   * Mention typeahead — active users by name.
   * @param {{ q: string, limit?: number }} input
   */
  async searchMentionUsers({ q, limit = 8 }) {
    const query = String(q || '').trim();
    if (query.length < 1) {
      return { items: [] };
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pageSize = Math.min(Math.max(Number(limit) || 8, 1), 20);

    const rows = await User.find({
      accountStatus: 'active',
      fullName: { $regex: escaped, $options: 'i' },
    })
      .select(
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .sort({ fullName: 1 })
      .limit(pageSize)
      .lean();

    return {
      items: rows.map((row) => ({
        id: String(row._id),
        fullName: row.fullName || '',
        role: row.role,
        verificationLevel: row.verificationLevel ?? 0,
        profilePhotoPath:
          row.profilePhotoPath ||
          row.officerPhotoPath ||
          row.instituteLogoPath ||
          '',
      })),
    };
  }

  /**
   * Admin: list pending recommendation achievements.
   */
  async listPendingRecommendations({ cursor, limit }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = {
      status: POST_STATUS.PUBLISHED,
      type: POST_TYPES.ACHIEVEMENT,
      'achievement.kind': 'recommended',
      'achievement.verificationStatus': 'pending',
    };

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .populate(
        'authorId',
        'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
      )
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    return {
      items: page.map((row) => serializePost(row, row.authorId)),
      nextCursor: hasMore && page.length ? String(page[page.length - 1]._id) : null,
      hasMore,
    };
  }

  /**
   * Admin: verify / reject recommendation achievement.
   * @param {{ postId: string, status: 'verified' | 'rejected' }} input
   */
  async verifyAchievement({ postId, status }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }
    if (!['verified', 'rejected'].includes(status)) {
      throw new AppError('Invalid verification status', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_STATUS',
      });
    }

    const post = await Post.findById(postId);
    if (
      !post ||
      post.status === POST_STATUS.DELETED ||
      post.type !== POST_TYPES.ACHIEVEMENT ||
      post.achievement?.kind !== 'recommended'
    ) {
      throw new AppError('Recommendation post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }

    post.achievement.verificationStatus = status;
    await post.save();
    await refreshTrendingScore(post.toObject());

    const fresh = await Post.findById(post._id).populate(
      'authorId',
      'fullName role verificationLevel profilePhotoPath officerPhotoPath instituteLogoPath',
    );
    return serializePost(fresh, fresh.authorId);
  }
}

const feedService = new FeedService();

module.exports = { feedService, serializePost };
