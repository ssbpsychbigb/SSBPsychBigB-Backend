'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { communityService } = require('./community.service');

/**
 * Community HTTP handlers — Module 5 MVP.
 */
class CommunityController {
  list = asyncHandler(async (req, res) => {
    const data = await communityService.listCommunities({
      q: req.query.q,
      examGoal: req.query.examGoal,
      cursor: req.query.cursor,
      limit: req.query.limit,
      viewerId: req.auth?.sub || null,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Communities',
      data,
    });
  });

  listMine = asyncHandler(async (req, res) => {
    const data = await communityService.listMine({
      userId: String(req.appUser._id),
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'My communities',
      data,
    });
  });

  create = asyncHandler(async (req, res) => {
    const data = await communityService.createCommunity({
      author: req.appUser,
      body: req.body || {},
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Community created',
      data,
    });
  });

  getBySlug = asyncHandler(async (req, res) => {
    const data = await communityService.getBySlug({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community',
      data,
    });
  });

  join = asyncHandler(async (req, res) => {
    const data = await communityService.join({
      slug: req.params.slug,
      user: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Joined community',
      data,
    });
  });

  leave = asyncHandler(async (req, res) => {
    const data = await communityService.leave({
      slug: req.params.slug,
      user: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Left community',
      data,
    });
  });

  feed = asyncHandler(async (req, res) => {
    const data = await communityService.getFeed({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community feed',
      data,
    });
  });

  announce = asyncHandler(async (req, res) => {
    const data = await communityService.createAnnouncement({
      slug: req.params.slug,
      author: req.appUser,
      body: req.body || {},
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Announcement posted',
      data,
    });
  });
}

const communityController = new CommunityController();

module.exports = { communityController };
