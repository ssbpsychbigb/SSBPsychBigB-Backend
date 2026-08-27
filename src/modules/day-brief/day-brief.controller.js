'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { dayBriefService } = require('./day-brief.service');

/**
 * Day Brief HTTP handlers.
 */
class DayBriefController {
  list = asyncHandler(async (req, res) => {
    const data = await dayBriefService.listFeed({
      viewerId: req.appUser?._id ? String(req.appUser._id) : req.auth?.sub,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Day Briefs',
      data,
    });
  });

  upload = asyncHandler(async (req, res) => {
    const data = await dayBriefService.uploadMedia({ file: req.file });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Media uploaded',
      data,
    });
  });

  create = asyncHandler(async (req, res) => {
    const data = await dayBriefService.create({
      user: req.appUser,
      caption: req.body?.caption,
      mediaUrl: req.body?.mediaUrl,
      mediaType: req.body?.mediaType,
      durationSec: req.body?.durationSec,
      thumbnailUrl: req.body?.thumbnailUrl,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Day Brief created',
      data,
    });
  });

  markViewed = asyncHandler(async (req, res) => {
    const data = await dayBriefService.markViewed({
      viewerId: String(req.appUser._id),
      briefId: req.params.id,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Marked viewed',
      data,
    });
  });

  remove = asyncHandler(async (req, res) => {
    const data = await dayBriefService.remove({
      user: req.appUser,
      briefId: req.params.id,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Day Brief deleted',
      data,
    });
  });
}

const dayBriefController = new DayBriefController();

module.exports = { dayBriefController };
