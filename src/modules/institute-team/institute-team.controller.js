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

    const isHire = data?.membershipKind === 'profile' && data?.joinSource === 'institute_hire';

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: isHire
        ? 'Hire invite sent. The freelancer can accept it from their educator dashboard.'
        : 'Team member invited. They can sign in with mobile OTP on the app.',
      data,
    });
  });

  /**
   * GET /institute/team/code
   */
  instituteCode = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.getInstituteCode({
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Institute code',
      data,
    });
  });

  /**
   * GET /institute/team/freelancers?q=
   */
  searchFreelancers = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.searchFreelancers({
      actor: req.appUser,
      q: req.query.q,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Freelancer educators',
      data,
    });
  });

  /**
   * POST /institute/team/hire
   */
  hireFreelancer = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.hireFreelancerById({
      actor: req.appUser,
      freelancerUserId: req.body.userId,
      permissions: req.body.permissions,
      examGoals: req.body.examGoals,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message:
        'Hire invite sent. The freelancer can accept it from their educator dashboard.',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/accept
   */
  acceptJoin = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.acceptJoinRequest({
      profileId: req.params.profileId,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Join request accepted',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/reject
   */
  rejectJoin = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.rejectJoinRequest({
      profileId: req.params.profileId,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Join request rejected',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/leave/decide
   */
  decideLeave = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.decideLeaveRequest({
      profileId: req.params.profileId,
      decision: req.body.decision,
      note: req.body.note,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message:
        req.body.decision === 'accept'
          ? 'Leave request accepted'
          : 'Leave request rejected',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/resign/decide
   */
  decideResign = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.decideResignRequest({
      profileId: req.params.profileId,
      decision: req.body.decision,
      note: req.body.note,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message:
        req.body.decision === 'accept'
          ? 'Resign accepted. 14-day notice period started.'
          : 'Resign request rejected',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/fire
   */
  fireMember = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.fireProfileMember({
      profileId: req.params.profileId,
      reason: req.body.reason,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Faculty released from this institute.',
      data,
    });
  });

  /**
   * POST /institute/team/profiles/:profileId/release
   */
  releaseNotice = asyncHandler(async (req, res) => {
    const data = await instituteTeamService.releaseNoticeEarly({
      profileId: req.params.profileId,
      reason: req.body.reason,
      actor: req.appUser,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Notice ended early. Collaboration closed.',
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
