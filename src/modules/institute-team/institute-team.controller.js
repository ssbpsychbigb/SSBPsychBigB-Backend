'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { toPublicUploadPath } = require('../auth/auth.upload');
const { instituteTeamService } = require('./institute-team.service');

/**
 * Institute team HTTP handlers.
 */
class InstituteTeamController {
  /**
   * GET /institute/team/catalog
   */
  catalog = asyncHandler(async (_req, res) => {
    const data = instituteTeamService.getPermissionCatalog();
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Institute permission catalog',
      data,
    });
  });

  /**
   * GET /institute/team
   */
  list = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.listTeam({ actor: req.appUser });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Institute team',
      data,
    });
  });

  /**
   * POST /institute/team (multipart optional profile photo)
   */
  invite = asyncHandler(async (req, res) => {
    const files = req.files || {};
    const profilePhotoPath = toPublicUploadPath(files.profilePhoto?.[0]);

    const data = await instituteTeamService.inviteMember({
      fullName: req.body.fullName,
      email: req.body.email,
      mobileNumber: req.body.mobileNumber,
      role: req.body.role,
      permissions: req.body.permissions,
      examGoals: req.body.examGoals,
      profilePhotoPath: profilePhotoPath || undefined,
      actor: req.appUser,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message:
        'Team member invited. They can sign in with mobile OTP on the app.',
      data,
    });
  });

  /**
   * PATCH /institute/team/:memberId (multipart optional profile photo)
   */
  update = asyncHandler(async (req, res) => {
    const files = req.files || {};
    const uploadedPath = toPublicUploadPath(files.profilePhoto?.[0]);

    /** @type {Record<string, unknown>} */
    const payload = {
      memberId: req.params.memberId,
      actor: req.appUser,
    };

    if (req.body.fullName !== undefined) {
      payload.fullName = req.body.fullName;
    }
    if (req.body.permissions !== undefined) {
      payload.permissions = req.body.permissions;
    }
    if (req.body.examGoals !== undefined) {
      payload.examGoals = req.body.examGoals;
    }
    if (req.body.accountStatus !== undefined) {
      payload.accountStatus = req.body.accountStatus;
    }
    if (uploadedPath) {
      payload.profilePhotoPath = uploadedPath;
    } else if (req.body.clearProfilePhoto === 'true') {
      payload.profilePhotoPath = '';
    }

    const data = await instituteTeamService.updateMember(payload);

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Team member updated',
      data,
    });
  });

  /**
   * DELETE /institute/team/:memberId
   */
  remove = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.removeMember({
      memberId: req.params.memberId,
      actor: req.appUser,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Team member removed',
      data,
    });
  });
}

module.exports = {
  instituteTeamController: new InstituteTeamController(),
};
