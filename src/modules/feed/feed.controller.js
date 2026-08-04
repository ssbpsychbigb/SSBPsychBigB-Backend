'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { feedService } = require('./feed.service');
const { feedEngagementService } = require('./feed-engagement.service');

/**
 * Feed HTTP handlers — Module 4 Phase A + B.
 */
class FeedController {
  meta = asyncHandler(async (_req, res) => {
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Feed meta',
      data: feedService.getMeta(),
    });
  });

  latest = asyncHandler(async (req, res) => {
    const data = await feedService.getLatestFeed({
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Latest feed',
      data,
    });
  });

  following = asyncHandler(async (req, res) => {
    const data = await feedService.getFollowingFeed({
      viewerId: String(req.appUser._id),
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Following feed',
      data,
    });
  });

  getById = asyncHandler(async (req, res) => {
    const data = await feedService.getPostById({
      postId: req.params.postId,
      viewerId: req.auth?.sub || null,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post',
      data,
    });
  });

  uploadMedia = asyncHandler(async (req, res) => {
    const data = feedService.uploadMedia({ files: req.files || [] });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Media uploaded',
      data,
    });
  });

  create = asyncHandler(async (req, res) => {
    const data = await feedService.createPost({
      author: req.appUser,
      body: req.body || {},
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Post created',
      data,
    });
  });

  update = asyncHandler(async (req, res) => {
    const data = await feedService.updatePost({
      author: req.appUser,
      postId: req.params.postId,
      body: req.body || {},
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post updated',
      data,
    });
  });

  remove = asyncHandler(async (req, res) => {
    const data = await feedService.deletePost({
      author: req.appUser,
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post deleted',
      data,
    });
  });

  toggleLike = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.toggleLike({
      user: req.appUser,
      postId: req.params.postId,
      reactionType: req.body?.reactionType || req.body?.type || 'like',
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.liked ? 'Reaction saved' : 'Reaction removed',
      data,
    });
  });

  toggleBookmark = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.toggleBookmark({
      user: req.appUser,
      postId: req.params.postId,
      folderName: req.body?.folderName,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.bookmarked ? 'Bookmarked' : 'Bookmark removed',
      data,
    });
  });

  listBookmarks = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.listBookmarks({
      user: req.appUser,
      cursor: req.query.cursor,
      limit: req.query.limit,
      folderName: req.query.folder,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Bookmarks',
      data,
    });
  });

  listBookmarkFolders = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.listBookmarkFolders({
      user: req.appUser,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Saved collections',
      data,
    });
  });

  createBookmarkFolder = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.createBookmarkFolder({
      user: req.appUser,
      name: req.body?.name,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Collection created',
      data,
    });
  });

  renameBookmarkFolder = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.renameBookmarkFolder({
      user: req.appUser,
      from: req.body?.from || req.params.folderName,
      to: req.body?.to || req.body?.name,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Collection renamed',
      data,
    });
  });

  deleteBookmarkFolder = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.deleteBookmarkFolder({
      user: req.appUser,
      name: req.body?.name || req.params.folderName,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Collection deleted',
      data,
    });
  });

  restorePost = asyncHandler(async (req, res) => {
    const data = await feedService.restorePost({
      author: req.appUser,
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post restored',
      data,
    });
  });

  listTrash = asyncHandler(async (req, res) => {
    const data = await feedService.listTrash({
      user: req.appUser,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Trash',
      data,
    });
  });

  listAdminTrash = asyncHandler(async (req, res) => {
    const data = await feedService.listAdminTrash({
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Admin trash',
      data,
    });
  });

  adminRestorePost = asyncHandler(async (req, res) => {
    const data = await feedService.adminRestorePost({
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post restored',
      data,
    });
  });

  permanentDeletePost = asyncHandler(async (req, res) => {
    const data = await feedService.permanentDeletePost({
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post permanently deleted',
      data,
    });
  });

  listReportedPosts = asyncHandler(async (req, res) => {
    const data = await feedService.listReportedPosts({
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Reported posts',
      data,
    });
  });

  listComments = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.listComments({
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Comments',
      data,
    });
  });

  addComment = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.addComment({
      user: req.appUser,
      postId: req.params.postId,
      content: req.body?.content,
      parentCommentId: req.body?.parentCommentId || null,
      media: req.body?.media || [],
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Comment added',
      data,
    });
  });

  uploadCommentMedia = asyncHandler(async (req, res) => {
    const data = feedService.uploadMedia({ files: req.files || [] });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Comment media uploaded',
      data,
    });
  });

  trackAnalytics = asyncHandler(async (req, res) => {
    const { emitFeedEvent } = require('./feed-analytics');
    const allowed = new Set([
      'video_completion',
      'read_time',
      'feed_viewed',
      'feed_refresh',
    ]);
    const event = String(req.body?.event || '').trim();
    if (!allowed.has(event)) {
      return ApiResponse.success(res, {
        statusCode: HTTP_STATUS.OK,
        message: 'Ignored',
        data: { accepted: false },
      });
    }
    emitFeedEvent({
      event,
      userId: req.auth?.sub || req.appUser?._id || null,
      postId: req.body?.postId || null,
      meta: req.body?.meta || {},
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Tracked',
      data: { accepted: true },
    });
  });

  report = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.reportPost({
      user: req.appUser,
      postId: req.params.postId,
      reason: req.body?.reason,
      note: req.body?.note,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Report submitted',
      data,
    });
  });

  share = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.sharePost({
      user: req.appUser,
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Share links',
      data,
    });
  });

  toggleFollow = asyncHandler(async (req, res) => {
    const data = await feedEngagementService.toggleFollow({
      user: req.appUser,
      targetUserId: req.params.userId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.following ? 'Following' : 'Unfollowed',
      data,
    });
  });

  trending = asyncHandler(async (req, res) => {
    const data = await feedService.getTrendingFeed({
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Trending feed',
      data,
    });
  });

  votePoll = asyncHandler(async (req, res) => {
    const { feedPhaseCService } = require('./feed-phase-c.service');
    const data = await feedPhaseCService.votePoll({
      user: req.appUser,
      postId: req.params.postId,
      optionId: req.body?.optionId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Vote recorded',
      data,
    });
  });

  togglePin = asyncHandler(async (req, res) => {
    const { feedPhaseCService } = require('./feed-phase-c.service');
    const data = await feedPhaseCService.togglePin({
      user: req.appUser,
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.pinned ? 'Pinned' : 'Unpinned',
      data,
    });
  });

  acceptAnswer = asyncHandler(async (req, res) => {
    const { feedPhaseCService } = require('./feed-phase-c.service');
    const data = await feedPhaseCService.acceptAnswer({
      user: req.appUser,
      postId: req.params.postId,
      commentId: req.body?.commentId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Answer accepted',
      data,
    });
  });

  listDrafts = asyncHandler(async (req, res) => {
    const { feedPhaseCService } = require('./feed-phase-c.service');
    const data = await feedPhaseCService.listDrafts({
      user: req.appUser,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Drafts',
      data,
    });
  });

  searchMentions = asyncHandler(async (req, res) => {
    const data = await feedService.searchMentionUsers({
      q: req.query.q,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Mention suggestions',
      data,
    });
  });

  listPendingRecommendations = asyncHandler(async (req, res) => {
    const data = await feedService.listPendingRecommendations({
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Pending recommendations',
      data,
    });
  });

  verifyAchievement = asyncHandler(async (req, res) => {
    const data = await feedService.verifyAchievement({
      postId: req.params.postId,
      status: req.body?.status,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message:
        data.achievement?.verificationStatus === 'verified'
          ? 'Recommendation verified'
          : 'Recommendation rejected',
      data,
    });
  });
}

const feedController = new FeedController();

module.exports = { feedController };
