'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { profileService } = require('./profile.service');
const {
  profilePhotoUpload,
  profileBannerUpload,
} = require('./profile.upload');
const { AppError } = require('../../common/errors/AppError');

/**
 * Wraps multer middleware into a promise for asyncHandler routes.
 */
function runUpload(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/**
 * Profile HTTP handlers — Module 3 Phase A.
 */
class ProfileController {
  getMe = asyncHandler(async (req, res) => {
    const data = await profileService.getMe(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'My profile',
      data,
    });
  });

  getByUsername = asyncHandler(async (req, res) => {
    const data = await profileService.getByUsername(
      req.params.username,
      req.auth?.sub || null,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile',
      data,
    });
  });

  updateMe = asyncHandler(async (req, res) => {
    const data = await profileService.updateMe(req.appUser, req.body || {});
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile updated',
      data,
    });
  });

  uploadPhoto = asyncHandler(async (req, res) => {
    await runUpload(profilePhotoUpload, req, res);
    if (!req.file) {
      throw new AppError('Photo file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'PHOTO_REQUIRED',
      });
    }
    const data = await profileService.updatePhoto(req.appUser, req.file);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile photo updated',
      data,
    });
  });

  uploadBanner = asyncHandler(async (req, res) => {
    await runUpload(profileBannerUpload, req, res);
    if (!req.file) {
      throw new AppError('Banner file is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'BANNER_REQUIRED',
      });
    }
    const data = await profileService.updateBanner(req.appUser, req.file);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Cover banner updated',
      data,
    });
  });

  listPosts = asyncHandler(async (req, res) => {
    const data = await profileService.getPostsByUsername(req.params.username, {
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile posts',
      data,
    });
  });

  listNetwork = asyncHandler(async (req, res) => {
    const data = await profileService.listNetwork(req.params.username, {
      kind: req.query.kind || req.params.kind,
      viewerId: req.auth?.sub || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile network',
      data,
    });
  });

  getNetworkOverview = asyncHandler(async (req, res) => {
    const data = await profileService.getNetworkOverview(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Network overview',
      data,
    });
  });

  getNetworkInsights = asyncHandler(async (req, res) => {
    const data = await profileService.getNetworkInsights(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Network insights',
      data,
    });
  });

  listSuggestions = asyncHandler(async (req, res) => {
    let viewer = req.appUser || null;
    if (!viewer && req.auth?.sub) {
      const { User } = require('../auth/user.model');
      viewer = await User.findById(req.auth.sub);
    }
    const data = await profileService.listSuggestions(viewer, {
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'People you may know',
      data,
    });
  });

  listTimeline = asyncHandler(async (req, res) => {
    const data = await profileService.listTimeline(
      req.params.username,
      req.auth?.sub || null,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Journey timeline',
      data,
    });
  });

  addTimeline = asyncHandler(async (req, res) => {
    const data = await profileService.addTimeline(req.appUser, req.body || {});
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Milestone added',
      data,
    });
  });

  removeTimeline = asyncHandler(async (req, res) => {
    const data = await profileService.removeTimeline(
      req.appUser,
      req.params.eventId,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Milestone removed',
      data,
    });
  });

  listAchievements = asyncHandler(async (req, res) => {
    const data = await profileService.listAchievements(
      req.params.username,
      req.auth?.sub || null,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Achievements',
      data,
    });
  });

  addAchievement = asyncHandler(async (req, res) => {
    const data = await profileService.addAchievement(req.appUser, req.body || {});
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Achievement added',
      data,
    });
  });

  removeAchievement = asyncHandler(async (req, res) => {
    const data = await profileService.removeAchievement(
      req.appUser,
      req.params.achievementId,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Achievement removed',
      data,
    });
  });
}

const profileController = new ProfileController();

module.exports = { profileController };
