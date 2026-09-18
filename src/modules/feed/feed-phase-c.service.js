'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { Post } = require('./post.model');
const { PollVote } = require('./poll-vote.model');
const { Comment } = require('./comment.model');
const {
  POST_STATUS,
  POST_TYPES,
  PIN_LIMITS,
  FEED_LIMITS,
} = require('./feed.constants');
const { refreshTrendingScore } = require('./feed-score');
const { serializePost } = require('./feed.service');
const { emitFeedEvent } = require('./feed-analytics');

class FeedPhaseCService {
  /**
   * Vote on a poll option (one vote per user; locked after endsAt).
   */
  async votePoll({ user, postId, optionId }) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError('Post not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POST_NOT_FOUND',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(optionId)) {
      throw new AppError('Invalid poll option', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_OPTION',
      });
    }

    const post = await Post.findById(postId);
    if (!post || post.status !== POST_STATUS.PUBLISHED || post.type !== POST_TYPES.POLL) {
      throw new AppError('Poll not found', HTTP_STATUS.NOT_FOUND, {
        code: 'POLL_NOT_FOUND',
      });
    }
    if (!post.poll?.options?.length) {
      throw new AppError('Poll has no options', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMPTY_POLL',
      });
    }
    if (post.poll.endsAt && new Date(post.poll.endsAt).getTime() < Date.now()) {
      throw new AppError('This poll has ended', HTTP_STATUS.BAD_REQUEST, {
        code: 'POLL_ENDED',
      });
    }

    const option = post.poll.options.id(optionId);
    if (!option) {
      throw new AppError('Poll option not found', HTTP_STATUS.NOT_FOUND, {
        code: 'OPTION_NOT_FOUND',
      });
    }

    const existing = await PollVote.findOne({ postId: post._id, userId: user._id });
    if (existing) {
      throw new AppError('You already voted on this poll', HTTP_STATUS.CONFLICT, {
        code: 'ALREADY_VOTED',
      });
    }

    await PollVote.create({
      postId: post._id,
      userId: user._id,
      optionId: option._id,
    });
    option.votes += 1;
    await post.save();
    await refreshTrendingScore(post);
    emitFeedEvent({
      event: 'poll_vote',
      userId: String(user._id),
      postId: String(post._id),
      meta: { optionId: String(option._id) },
    });

    return {
      optionId: String(option._id),
      poll: {
        duration: post.poll.duration,
        endsAt: post.poll.endsAt,
        options: post.poll.options.map((opt) => ({
          id: String(opt._id),
          text: opt.text,
          votes: opt.votes,
        })),
      },
    };
  }

  /**
   * Pin / unpin own post (role-based limits).
   */
  async togglePin({ user, postId }) {
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
    if (String(post.authorId) !== String(user._id)) {
      throw new AppError('You can only pin your own posts', HTTP_STATUS.FORBIDDEN, {
        code: 'NOT_POST_OWNER',
      });
    }

    if (post.pinnedAt) {
      post.pinnedAt = null;
      await post.save();
      await refreshTrendingScore(post);
      return { pinned: false, pinnedAt: null };
    }

    const limit = PIN_LIMITS[user.role] ?? PIN_LIMITS.user;
    const pinnedCount = await Post.countDocuments({
      authorId: user._id,
      status: { $in: [POST_STATUS.PUBLISHED, POST_STATUS.DRAFT] },
      pinnedAt: { $ne: null },
    });

    if (pinnedCount >= limit) {
      throw new AppError(
        `You can pin at most ${limit} post(s)`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'PIN_LIMIT' },
      );
    }

    post.pinnedAt = new Date();
    await post.save();
    await refreshTrendingScore(post);
    return { pinned: true, pinnedAt: post.pinnedAt };
  }

  /**
   * Accept an answer on a question post (Ask a Mentor style).
   */
  async acceptAnswer({ user, postId, commentId }) {
    if (
      !mongoose.Types.ObjectId.isValid(postId) ||
      !mongoose.Types.ObjectId.isValid(commentId)
    ) {
      throw new AppError('Not found', HTTP_STATUS.NOT_FOUND, { code: 'NOT_FOUND' });
    }

    const post = await Post.findById(postId);
    if (!post || post.status !== POST_STATUS.PUBLISHED || post.type !== POST_TYPES.QUESTION) {
      throw new AppError('Question not found', HTTP_STATUS.NOT_FOUND, {
        code: 'QUESTION_NOT_FOUND',
      });
    }
    if (String(post.authorId) !== String(user._id)) {
      throw new AppError(
        'Only the question author can accept an answer',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_QUESTION_OWNER' },
      );
    }

    const comment = await Comment.findOne({
      _id: commentId,
      postId: post._id,
      status: 'published',
    });
    if (!comment) {
      throw new AppError('Comment not found', HTTP_STATUS.NOT_FOUND, {
        code: 'COMMENT_NOT_FOUND',
      });
    }

    if (!post.question) {
      post.question = { isAskMentor: false, acceptedAnswerId: null };
    }
    post.question.acceptedAnswerId = comment._id;
    await post.save();
    await refreshTrendingScore(post);

    return {
      acceptedAnswerId: String(comment._id),
    };
  }

  /**
   * List own drafts.
   */
  async listDrafts({ user, cursor, limit }) {
    const pageSize = Math.min(
      Math.max(Number(limit) || FEED_LIMITS.DEFAULT_PAGE_SIZE, 1),
      FEED_LIMITS.MAX_PAGE_SIZE,
    );

    const filter = {
      authorId: user._id,
      status: POST_STATUS.DRAFT,
    };

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Post.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
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
}

const feedPhaseCService = new FeedPhaseCService();

module.exports = {
  feedPhaseCService,
};
