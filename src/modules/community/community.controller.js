'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { AppError } = require('../../common/errors/AppError');
const { communityService } = require('./community.service');
const {
  communityResourceService,
} = require('./community-resource.service');
const {
  communityEventService,
} = require('./community-event.service');
const {
  toResourcePublicPath,
  detectResourceKind,
  formatBytes,
} = require('./community-resource.upload');

/**
 * Community HTTP handlers — Module 5 (+ W4 depth).
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
      inviteToken: req.query.invite || null,
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
      inviteToken: req.body?.inviteToken || req.query.invite || null,
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

  listMembers = asyncHandler(async (req, res) => {
    const data = await communityService.listMembers({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community members',
      data,
    });
  });

  invite = asyncHandler(async (req, res) => {
    const data = await communityService.getOrRotateInvite({
      slug: req.params.slug,
      actor: req.appUser,
      rotate: Boolean(req.body?.rotate),
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: req.body?.rotate ? 'Invite link rotated' : 'Invite link',
      data,
    });
  });

  removePost = asyncHandler(async (req, res) => {
    const data = await communityService.removePost({
      slug: req.params.slug,
      actor: req.appUser,
      postId: req.params.postId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Post removed from community',
      data,
    });
  });

  kickMember = asyncHandler(async (req, res) => {
    const data = await communityService.kickMember({
      slug: req.params.slug,
      actor: req.appUser,
      userId: req.params.userId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Member removed',
      data,
    });
  });

  muteMember = asyncHandler(async (req, res) => {
    const data = await communityService.muteMember({
      slug: req.params.slug,
      actor: req.appUser,
      userId: req.params.userId,
      mutedUntil: req.body?.mutedUntil ?? null,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.isMuted ? 'Member muted' : 'Member unmuted',
      data,
    });
  });

  setMemberRole = asyncHandler(async (req, res) => {
    const data = await communityService.setMemberRole({
      slug: req.params.slug,
      actor: req.appUser,
      userId: req.params.userId,
      role: req.body?.role,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Member role updated',
      data,
    });
  });

  pinPost = asyncHandler(async (req, res) => {
    const pinned = req.body?.pinned !== false && req.method !== 'DELETE';
    const data = await communityService.pinPost({
      slug: req.params.slug,
      actor: req.appUser,
      postId: req.params.postId,
      pinned,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: pinned ? 'Post pinned in community' : 'Post unpinned',
      data,
    });
  });

  feed = asyncHandler(async (req, res) => {
    const data = await communityService.getFeed({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
      type: req.query.type || null,
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

  listResources = asyncHandler(async (req, res) => {
    const data = await communityResourceService.listResources({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
      q: req.query.q,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community resources',
      data,
    });
  });

  uploadResourceFile = asyncHandler(async (req, res) => {
    await communityResourceService.assertModeratorBySlug(
      req.params.slug,
      req.appUser._id,
    );
    if (!req.file) {
      throw new AppError('File is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'FILE_REQUIRED',
      });
    }
    const mime = String(req.file.mimetype || '').toLowerCase();
    const data = {
      url: toResourcePublicPath(req.file),
      fileName: req.file.originalname || req.file.filename,
      mime,
      size: Number(req.file.size) || 0,
      sizeLabel: formatBytes(req.file.size),
      kind: detectResourceKind(mime),
    };
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Resource file uploaded',
      data,
    });
  });

  createResource = asyncHandler(async (req, res) => {
    const data = await communityResourceService.createResource({
      slug: req.params.slug,
      user: req.appUser,
      body: req.body || {},
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Resource added',
      data,
    });
  });

  pinResource = asyncHandler(async (req, res) => {
    const pinned = req.body?.pinned !== false && req.method !== 'DELETE';
    const data = await communityResourceService.setPinned({
      slug: req.params.slug,
      user: req.appUser,
      resourceId: req.params.resourceId,
      pinned,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: pinned ? 'Resource pinned' : 'Resource unpinned',
      data,
    });
  });

  deleteResource = asyncHandler(async (req, res) => {
    const data = await communityResourceService.deleteResource({
      slug: req.params.slug,
      user: req.appUser,
      resourceId: req.params.resourceId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Resource deleted',
      data,
    });
  });

  listEvents = asyncHandler(async (req, res) => {
    const data = await communityEventService.listEvents({
      slug: req.params.slug,
      viewerId: req.auth?.sub || null,
      scope: req.query.scope,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community events',
      data,
    });
  });

  createEvent = asyncHandler(async (req, res) => {
    const data = await communityEventService.createEvent({
      slug: req.params.slug,
      user: req.appUser,
      body: req.body || {},
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Event created',
      data,
    });
  });

  cancelEvent = asyncHandler(async (req, res) => {
    const data = await communityEventService.cancelEvent({
      slug: req.params.slug,
      user: req.appUser,
      eventId: req.params.eventId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Event cancelled',
      data,
    });
  });

  setEventRsvp = asyncHandler(async (req, res) => {
    const data = await communityEventService.setRsvp({
      slug: req.params.slug,
      user: req.appUser,
      eventId: req.params.eventId,
      status: req.body?.status,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'RSVP saved',
      data,
    });
  });

  clearEventRsvp = asyncHandler(async (req, res) => {
    const data = await communityEventService.clearRsvp({
      slug: req.params.slug,
      user: req.appUser,
      eventId: req.params.eventId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'RSVP cleared',
      data,
    });
  });

  analytics = asyncHandler(async (req, res) => {
    const data = await communityService.getAnalytics({
      slug: req.params.slug,
      userId: req.appUser._id,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Community analytics',
      data,
    });
  });
}

const communityController = new CommunityController();

module.exports = { communityController };
