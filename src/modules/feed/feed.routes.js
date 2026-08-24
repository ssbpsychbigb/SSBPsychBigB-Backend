'use strict';

const { Router } = require('express');
const { feedController } = require('./feed.controller');
const { feedMediaUpload, commentMediaUpload } = require('./feed.upload');
const {
  requireAppAuth,
  requireAppUser,
  optionalAppAuth,
} = require('../../common/middleware/requireAppAuth');
const { createRateLimiter } = require('../../common/middleware/rateLimit');
const { FEED_RATE_LIMITS } = require('./feed.constants');

/**
 * Feed routes — Module 4 Phase A–D.
 */
const feedRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

const limitCreate = createRateLimiter({
  ...FEED_RATE_LIMITS.CREATE_POST,
  keyPrefix: 'feed:create',
  message: 'Posting too fast. Please wait a few minutes.',
});

const limitComment = createRateLimiter({
  ...FEED_RATE_LIMITS.COMMENT,
  keyPrefix: 'feed:comment',
  message: 'Commenting too fast. Please slow down.',
});

const limitMedia = createRateLimiter({
  ...FEED_RATE_LIMITS.MEDIA_UPLOAD,
  keyPrefix: 'feed:media',
  message: 'Too many uploads. Please wait a few minutes.',
});

const limitEngage = createRateLimiter({
  ...FEED_RATE_LIMITS.ENGAGE,
  keyPrefix: 'feed:engage',
  message: 'Too many actions. Please wait a moment.',
});

feedRouter.get('/feed/meta', feedController.meta);
feedRouter.get('/feed/latest', optionalAppAuth, feedController.latest);
feedRouter.get('/feed/reels', optionalAppAuth, feedController.reels);
feedRouter.get('/feed/following', ...requireActiveAppUser, feedController.following);
feedRouter.get('/feed/trending', optionalAppAuth, feedController.trending);
feedRouter.get(
  '/feed/mentions',
  ...requireActiveAppUser,
  feedController.searchMentions,
);

feedRouter.get('/bookmarks', ...requireActiveAppUser, feedController.listBookmarks);
feedRouter.get(
  '/bookmarks/folders',
  ...requireActiveAppUser,
  feedController.listBookmarkFolders,
);
feedRouter.post(
  '/bookmarks/folders',
  ...requireActiveAppUser,
  feedController.createBookmarkFolder,
);
feedRouter.patch(
  '/bookmarks/folders',
  ...requireActiveAppUser,
  feedController.renameBookmarkFolder,
);
feedRouter.delete(
  '/bookmarks/folders',
  ...requireActiveAppUser,
  feedController.deleteBookmarkFolder,
);
feedRouter.get('/posts/drafts', ...requireActiveAppUser, feedController.listDrafts);
feedRouter.get('/posts/trash', ...requireActiveAppUser, feedController.listTrash);

feedRouter.get('/posts/:postId', optionalAppAuth, feedController.getById);
feedRouter.get('/posts/:postId/comments', optionalAppAuth, feedController.listComments);

feedRouter.post(
  '/feed/analytics',
  optionalAppAuth,
  feedController.trackAnalytics,
);

feedRouter.post(
  '/posts/media',
  ...requireActiveAppUser,
  limitMedia,
  feedMediaUpload,
  feedController.uploadMedia,
);

feedRouter.post(
  '/posts/comment-media',
  ...requireActiveAppUser,
  limitMedia,
  commentMediaUpload,
  feedController.uploadCommentMedia,
);

feedRouter.post('/posts', ...requireActiveAppUser, limitCreate, feedController.create);
feedRouter.patch('/posts/:postId', ...requireActiveAppUser, feedController.update);
feedRouter.delete('/posts/:postId', ...requireActiveAppUser, feedController.remove);
feedRouter.post(
  '/posts/:postId/restore',
  ...requireActiveAppUser,
  feedController.restorePost,
);

feedRouter.post(
  '/posts/:postId/like',
  ...requireActiveAppUser,
  limitEngage,
  feedController.toggleLike,
);
feedRouter.post(
  '/posts/:postId/comments',
  ...requireActiveAppUser,
  limitComment,
  feedController.addComment,
);
feedRouter.post(
  '/posts/:postId/bookmark',
  ...requireActiveAppUser,
  limitEngage,
  feedController.toggleBookmark,
);
feedRouter.post('/posts/:postId/report', ...requireActiveAppUser, feedController.report);
feedRouter.post(
  '/posts/:postId/share',
  ...requireActiveAppUser,
  limitEngage,
  feedController.share,
);
feedRouter.post(
  '/posts/:postId/poll/vote',
  ...requireActiveAppUser,
  limitEngage,
  feedController.votePoll,
);
feedRouter.post('/posts/:postId/pin', ...requireActiveAppUser, feedController.togglePin);
feedRouter.post(
  '/posts/:postId/accept-answer',
  ...requireActiveAppUser,
  feedController.acceptAnswer,
);

feedRouter.post('/follows/:userId', ...requireActiveAppUser, feedController.toggleFollow);

module.exports = { feedRouter };
