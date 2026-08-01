'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { authService, toPublicUser } = require('./auth.service');
const { User } = require('./user.model');
const {
  educatorCollabService,
  toProfileSummary,
} = require('../educator-profile/educator-collab.service');
const {
  educatorHrService,
} = require('../educator-profile/educator-hr.service');

/**
 * Auth HTTP handlers for app-portal OTP registration and login.
 */
class AuthController {
  /**
   * POST /auth/register
   */
  register = asyncHandler(async (req, res) => {
    const data = await authService.startRegistration({
      body: req.body,
      files: req.files || {},
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: data.message || 'OTP sent',
      data,
    });
  });

  /**
   * POST /auth/otp/send
   */
  sendOtp = asyncHandler(async (req, res) => {
    const data = await authService.sendOtp({
      mobileNumber: req.body.mobileNumber,
      purpose: req.body.purpose,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'OTP sent',
      data,
    });
  });

  /**
   * POST /auth/otp/verify
   */
  verifyOtp = asyncHandler(async (req, res) => {
    const data = await authService.verifyOtp({
      mobileNumber: req.body.mobileNumber,
      otp: req.body.otp,
      purpose: req.body.purpose,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Verified successfully',
      data,
    });
  });

  /**
   * GET /auth/me
   */
  me = asyncHandler(async (req, res) => {
    const data = await authService.getMe(req.auth.sub);

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Current user',
      data,
    });
  });

  /**
   * POST /auth/application/resubmit
   */
  resubmitApplication = asyncHandler(async (req, res) => {
    const data = await authService.resubmitApplication({
      userId: req.auth.sub,
      body: req.body,
      files: req.files || {},
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Application resubmitted for review',
      data,
    });
  });

  /**
   * POST /auth/educator/join-requests
   */
  requestJoin = asyncHandler(async (req, res) => {
    const data = await educatorCollabService.requestJoin({
      userId: req.auth.sub,
      instituteCode: req.body.instituteCode,
      instituteId: req.body.instituteId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Join request sent. Wait for the institute to accept.',
      data,
    });
  });

  /**
   * GET /auth/educator/institutes?q=
   */
  listInstitutes = asyncHandler(async (req, res) => {
    const data = await educatorCollabService.listInstitutes({
      userId: req.auth.sub,
      q: req.query.q,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Institutes',
      data,
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/accept
   */
  acceptHire = asyncHandler(async (req, res) => {
    const data = await educatorCollabService.acceptHireInvite({
      userId: req.auth.sub,
      profileId: req.params.profileId,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Hire invite accepted',
      data,
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/decline
   */
  declineCollab = asyncHandler(async (req, res) => {
    const data = await educatorCollabService.declineOrCancelCollab({
      userId: req.auth.sub,
      profileId: req.params.profileId,
      reason: req.body.reason,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Collaboration declined',
      data,
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/leave
   */
  requestLeave = asyncHandler(async (req, res) => {
    const profile = await educatorHrService.requestLeave({
      userId: req.auth.sub,
      profileId: req.params.profileId,
      reason: req.body.reason,
      leaveStartsAt: req.body.leaveStartsAt,
      leaveEndsAt: req.body.leaveEndsAt,
      leaveRequestId: req.body.leaveRequestId,
      updatePending: Boolean(req.body.updatePending),
    });
    const institute = await User.findById(profile.instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Leave request sent to the institute.',
      data: toProfileSummary(profile, institute),
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/leave/cancel
   */
  cancelLeave = asyncHandler(async (req, res) => {
    const profile = await educatorHrService.cancelLeaveRequest({
      userId: req.auth.sub,
      profileId: req.params.profileId,
      leaveRequestId: req.body?.leaveRequestId,
    });
    const institute = await User.findById(profile.instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Leave request cancelled.',
      data: toProfileSummary(profile, institute),
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/resign
   */
  requestResign = asyncHandler(async (req, res) => {
    const profile = await educatorHrService.requestResign({
      userId: req.auth.sub,
      profileId: req.params.profileId,
      reason: req.body.reason,
    });
    const institute = await User.findById(profile.instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message:
        'Resign request sent. Notice period starts only after the institute accepts.',
      data: toProfileSummary(profile, institute),
    });
  });

  /**
   * POST /auth/educator/collaborations/:profileId/resign/cancel
   */
  cancelResign = asyncHandler(async (req, res) => {
    const profile = await educatorHrService.cancelResignRequest({
      userId: req.auth.sub,
      profileId: req.params.profileId,
    });
    const institute = await User.findById(profile.instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Resign request cancelled.',
      data: toProfileSummary(profile, institute),
    });
  });

  /**
   * POST /auth/profiles/:profileId/switch
   */
  switchProfile = asyncHandler(async (req, res) => {
    const data = await educatorCollabService.switchProfile({
      userId: req.auth.sub,
      profileId: req.params.profileId,
      toPublicUser,
    });

    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Profile switched',
      data,
    });
  });
}

module.exports = { authController: new AuthController() };
