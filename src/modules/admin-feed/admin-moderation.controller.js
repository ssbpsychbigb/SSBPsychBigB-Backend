'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { adminModerationService } = require('./admin-moderation.service');

function noteOf(req) {
  return String(req.body?.note || '').trim();
}

/**
 * Admin moderation HTTP handlers — W1 hide / warn / resolve / lock.
 */
class AdminModerationController {
  listReports = asyncHandler(async (req, res) => {
    const data = await adminModerationService.listReportedPosts({
      cursor: req.query.cursor,
      limit: req.query.limit,
      scope: req.query.scope,
      queue: req.query.queue,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Reported posts',
      data,
    });
  });

  listComments = asyncHandler(async (req, res) => {
    const data = await adminModerationService.listPostComments({
      postId: req.params.postId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post comments',
      data,
    });
  });

  hidePost = asyncHandler(async (req, res) => {
    const data = await adminModerationService.hidePost({
      admin: req.admin,
      postId: req.params.postId,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post hidden',
      data,
    });
  });

  unhidePost = asyncHandler(async (req, res) => {
    const data = await adminModerationService.unhidePost({
      admin: req.admin,
      postId: req.params.postId,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post restored to feed',
      data,
    });
  });

  lockComments = asyncHandler(async (req, res) => {
    const data = await adminModerationService.setCommentsLocked({
      admin: req.admin,
      postId: req.params.postId,
      locked: true,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Comments locked',
      data,
    });
  });

  unlockComments = asyncHandler(async (req, res) => {
    const data = await adminModerationService.setCommentsLocked({
      admin: req.admin,
      postId: req.params.postId,
      locked: false,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Comments unlocked',
      data,
    });
  });

  hideComment = asyncHandler(async (req, res) => {
    const data = await adminModerationService.hideComment({
      admin: req.admin,
      commentId: req.params.commentId,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Comment removed',
      data,
    });
  });

  resolveReports = asyncHandler(async (req, res) => {
    const data = await adminModerationService.resolveReports({
      admin: req.admin,
      postId: req.params.postId,
      outcome: req.body?.outcome,
      note: noteOf(req),
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Reports updated',
      data,
    });
  });

  warnUser = asyncHandler(async (req, res) => {
    const data = await adminModerationService.warnUser({
      admin: req.admin,
      userId: req.params.userId,
      reason: req.body?.reason,
      note: noteOf(req),
      postId: req.body?.postId || null,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'User warned',
      data,
    });
  });
}

const adminModerationController = new AdminModerationController();

module.exports = { adminModerationController };
