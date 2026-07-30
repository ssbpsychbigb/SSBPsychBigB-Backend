'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { mailService } = require('../../common/mail/mail.service');
const { User } = require('../auth/user.model');
const { APP_ROLES, INSTITUTE_PERMISSIONS } = require('../auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
  EXIT_ENDED_BY,
} = require('./educator-profile.model');
const {
  DEFAULT_RESIGN_NOTICE_DAYS,
  MAX_LEAVE_DAYS,
  OPEN_COLLAB_STATUSES,
  ENTERABLE_COLLAB_STATUSES,
  requireReason,
  addDays,
  parseDateOnly,
} = require('./educator-hr.constants');

/**
 * @param {Error} error
 * @returns {never}
 */
function rethrowReasonError(error) {
  if (error && (error.code === 'REASON_REQUIRED' || error.code === 'REASON_TOO_LONG' || error.code === 'INVALID_DATE')) {
    throw new AppError(error.message, HTTP_STATUS.BAD_REQUEST, {
      code: error.code,
    });
  }
  throw error;
}

const LEAVE_REQ = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

/** Statuses that leave workflow must not override. */
const LEAVE_STATUS_LOCKED = new Set([
  EDUCATOR_PROFILE_STATUSES.RESIGN_PENDING,
  EDUCATOR_PROFILE_STATUSES.NOTICE_PERIOD,
  EDUCATOR_PROFILE_STATUSES.ENDED,
  EDUCATOR_PROFILE_STATUSES.SUSPENDED,
  EDUCATOR_PROFILE_STATUSES.REJECTED,
  EDUCATOR_PROFILE_STATUSES.PENDING_VERIFICATION,
  EDUCATOR_PROFILE_STATUSES.INVITED,
  EDUCATOR_PROFILE_STATUSES.PENDING_ACCEPTANCE,
]);

/**
 * Clears legacy scalar leave mirror fields.
 * @param {import('mongoose').Document} profile
 */
function clearLeaveFields(profile) {
  profile.leaveReason = '';
  profile.leaveStartsAt = null;
  profile.leaveEndsAt = null;
  profile.leaveRequestedAt = null;
  profile.leaveDecidedAt = null;
  profile.leaveDecisionNote = '';
}

/**
 * Migrates old scalar leave fields into leaveRequests once.
 * @param {import('mongoose').Document} profile
 */
function ensureLeaveRequestsMigrated(profile) {
  if (!Array.isArray(profile.leaveRequests)) {
    profile.leaveRequests = [];
  }
  if (profile.leaveRequests.length > 0) {
    return;
  }
  if (!profile.leaveStartsAt || !profile.leaveEndsAt) {
    return;
  }
  if (profile.status === EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING) {
    profile.leaveRequests.push({
      reason: profile.leaveReason || '',
      startsAt: profile.leaveStartsAt,
      endsAt: profile.leaveEndsAt,
      requestedAt: profile.leaveRequestedAt || new Date(),
      decidedAt: null,
      decisionNote: '',
      status: LEAVE_REQ.PENDING,
    });
    return;
  }
  if (profile.status === EDUCATOR_PROFILE_STATUSES.ON_LEAVE) {
    profile.leaveRequests.push({
      reason: profile.leaveReason || '',
      startsAt: profile.leaveStartsAt,
      endsAt: profile.leaveEndsAt,
      requestedAt: profile.leaveRequestedAt || new Date(),
      decidedAt: profile.leaveDecidedAt || null,
      decisionNote: profile.leaveDecisionNote || '',
      status: LEAVE_REQ.APPROVED,
    });
  }
}

/**
 * Marks expired approved leaves completed and mirrors legacy scalars.
 * @param {import('mongoose').Document} profile
 */
function syncLeaveRequestsAndLegacy(profile) {
  ensureLeaveRequestsMigrated(profile);
  const now = Date.now();
  for (const req of profile.leaveRequests) {
    if (
      req.status === LEAVE_REQ.APPROVED &&
      req.endsAt &&
      req.endsAt.getTime() <= now
    ) {
      req.status = LEAVE_REQ.COMPLETED;
    }
  }

  const pending = profile.leaveRequests.filter(
    (r) => r.status === LEAVE_REQ.PENDING,
  );
  const liveApproved = profile.leaveRequests
    .filter(
      (r) =>
        r.status === LEAVE_REQ.APPROVED &&
        r.endsAt &&
        r.endsAt.getTime() > now,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const activeApproved = liveApproved.find(
    (r) => r.startsAt && r.startsAt.getTime() <= now,
  );
  const upcomingApproved = liveApproved.find(
    (r) => r.startsAt && r.startsAt.getTime() > now,
  );

  const mirror = activeApproved || pending[0] || upcomingApproved || null;
  if (!mirror) {
    clearLeaveFields(profile);
    return {
      hasPending: pending.length > 0,
      hasApprovedLeave: false,
    };
  }

  profile.leaveReason = mirror.reason || '';
  profile.leaveStartsAt = mirror.startsAt;
  profile.leaveEndsAt = mirror.endsAt;
  profile.leaveRequestedAt = mirror.requestedAt || null;
  profile.leaveDecidedAt = mirror.decidedAt || null;
  profile.leaveDecisionNote = mirror.decisionNote || '';
  return {
    hasPending: pending.length > 0,
    // * Approved leave (current or upcoming) keeps collab in on_leave.
    hasApprovedLeave: liveApproved.length > 0,
  };
}

/**
 * Sets collab status from leaveRequests (active / leave_pending / on_leave).
 * @param {import('mongoose').Document} profile
 */
function reconcileLeaveCollabStatus(profile) {
  if (LEAVE_STATUS_LOCKED.has(profile.status)) {
    syncLeaveRequestsAndLegacy(profile);
    return;
  }
  const { hasPending, hasApprovedLeave } = syncLeaveRequestsAndLegacy(profile);
  // * Approved leave wins over pending for profile.status display;
  // * pending rows still exist in leaveRequests for institute review.
  if (hasApprovedLeave) {
    profile.status = EDUCATOR_PROFILE_STATUSES.ON_LEAVE;
    return;
  }
  if (hasPending) {
    profile.status = EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING;
    return;
  }
  if (
    profile.status === EDUCATOR_PROFILE_STATUSES.ON_LEAVE ||
    profile.status === EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING
  ) {
    profile.status = EDUCATOR_PROFILE_STATUSES.ACTIVE;
  }
}

/**
 * @param {import('mongoose').Document} profile
 * @param {string|undefined} leaveRequestId
 * @param {string} status
 */
function findLeaveRequest(profile, leaveRequestId, status) {
  ensureLeaveRequestsMigrated(profile);
  const list = profile.leaveRequests.filter((r) => r.status === status);
  if (leaveRequestId) {
    const found = list.find((r) => String(r._id) === String(leaveRequestId));
    if (!found) {
      throw new AppError(
        'Leave request not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'LEAVE_NOT_FOUND' },
      );
    }
    return found;
  }
  if (list.length === 1) {
    return list[0];
  }
  if (list.length === 0) {
    throw new AppError(
      'Leave request not found.',
      HTTP_STATUS.NOT_FOUND,
      { code: 'LEAVE_NOT_FOUND' },
    );
  }
  throw new AppError(
    'Multiple leave requests found. Pass leaveRequestId.',
    HTTP_STATUS.BAD_REQUEST,
    { code: 'LEAVE_REQUEST_ID_REQUIRED' },
  );
}

/**
 * Clears resign/notice workflow fields after cancel/reject (not after end).
 * @param {import('mongoose').Document} profile
 */
function clearResignPendingFields(profile) {
  profile.resignReason = '';
  profile.resignRequestedAt = null;
  profile.resignDecidedAt = null;
  profile.resignDecisionNote = '';
  profile.noticeStartedAt = null;
  profile.noticeEndsAt = null;
  profile.noticeDays = null;
}

/**
 * @param {import('mongoose').Document} profile
 * @param {{
 *   endedBy: string,
 *   exitReason: string,
 * }} input
 */
async function markEnded(profile, { endedBy, exitReason }) {
  profile.status = EDUCATOR_PROFILE_STATUSES.ENDED;
  profile.endedAt = new Date();
  profile.endedBy = endedBy;
  profile.exitReason = exitReason;
  profile.previousStatus = '';
  await profile.save();

  const user = await User.findById(profile.userId);
  if (
    user &&
    user.activeProfileId &&
    String(user.activeProfileId) === String(profile._id)
  ) {
    user.activeProfileId = null;
    await user.save();
  }

  return profile;
}

/**
 * Auto-completes leave / notice when dates pass.
 * @param {import('mongoose').Document} profile
 * @returns {Promise<import('mongoose').Document>}
 */
async function syncProfileLifecycle(profile) {
  if (!profile || profile.type !== EDUCATOR_PROFILE_TYPES.INSTITUTE) {
    return profile;
  }

  const beforeStatus = profile.status;
  reconcileLeaveCollabStatus(profile);
  if (profile.status !== beforeStatus || profile.isModified()) {
    await profile.save();
  }

  const now = new Date();
  if (
    profile.status === EDUCATOR_PROFILE_STATUSES.NOTICE_PERIOD &&
    profile.noticeEndsAt &&
    profile.noticeEndsAt.getTime() <= now.getTime()
  ) {
    return markEnded(profile, {
      endedBy: EXIT_ENDED_BY.SYSTEM_NOTICE_COMPLETE,
      exitReason:
        profile.resignReason ||
        'Notice period completed. Collaboration ended automatically.',
    });
  }

  return profile;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} instituteId
 */
async function findOpenCollab(userId, instituteId) {
  return EducatorProfile.findOne({
    userId,
    type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
    instituteId,
    status: { $in: [...OPEN_COLLAB_STATUSES] },
  });
}

/**
 * @param {import('mongoose').Document} actor
 */
function assertCanDecideHr(actor) {
  if (actor.role === APP_ROLES.INSTITUTE) {
    return;
  }
  const perms = Array.isArray(actor.permissions) ? actor.permissions : [];
  if (
    perms.includes(INSTITUTE_PERMISSIONS.TEAM_MANAGE) ||
    perms.includes(INSTITUTE_PERMISSIONS.FACULTY_ADD) ||
    perms.includes(INSTITUTE_PERMISSIONS.FACULTY_REMOVE)
  ) {
    return;
  }
  throw new AppError(
    'You do not have permission to manage leave or resign requests.',
    HTTP_STATUS.FORBIDDEN,
    { code: 'INSTITUTE_FORBIDDEN' },
  );
}

/**
 * HR workflows for institute educator memberships.
 */
class EducatorHrService {
  /**
   * Educator creates a fresh leave request, or updates one pending request.
   * Approved leave is never overwritten — pass leaveRequestId only to edit pending.
   * @param {{
   *   userId: string,
   *   profileId: string,
   *   reason: string,
   *   leaveStartsAt: string,
   *   leaveEndsAt: string,
   *   leaveRequestId?: string,
   * }} input
   */
  async requestLeave({
    userId,
    profileId,
    reason,
    leaveStartsAt,
    leaveEndsAt,
    leaveRequestId,
    updatePending,
  }) {
    let leaveReason;
    let startsAt;
    let endsAt;
    try {
      leaveReason = requireReason(reason, 'Leave reason');
      startsAt = parseDateOnly(leaveStartsAt, 'Leave start date');
      endsAt = parseDateOnly(leaveEndsAt, 'Leave end date');
    } catch (error) {
      rethrowReasonError(error);
    }

    if (endsAt.getTime() < startsAt.getTime()) {
      throw new AppError(
        'Leave end date must be on or after the start date.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_LEAVE_RANGE' },
      );
    }

    const spanDays =
      Math.round((endsAt.getTime() - startsAt.getTime()) / 86400000) + 1;
    if (spanDays > MAX_LEAVE_DAYS) {
      throw new AppError(
        `Leave cannot exceed ${MAX_LEAVE_DAYS} days.`,
        HTTP_STATUS.BAD_REQUEST,
        { code: 'LEAVE_TOO_LONG' },
      );
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
    });
    if (!profile) {
      throw new AppError('Collaboration not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'COLLAB_NOT_FOUND',
      });
    }

    await syncProfileLifecycle(profile);
    ensureLeaveRequestsMigrated(profile);

    const canRequest =
      profile.status === EDUCATOR_PROFILE_STATUSES.ACTIVE ||
      profile.status === EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING ||
      profile.status === EDUCATOR_PROFILE_STATUSES.ON_LEAVE;

    if (!canRequest) {
      throw new AppError(
        'Leave can only be requested while active, on leave, or with a pending leave request.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'LEAVE_NOT_ALLOWED' },
      );
    }

    if (leaveRequestId || updatePending) {
      // * Update only an existing pending request — never approved leave.
      const pending = findLeaveRequest(
        profile,
        leaveRequestId || undefined,
        LEAVE_REQ.PENDING,
      );
      pending.reason = leaveReason;
      pending.startsAt = startsAt;
      pending.endsAt = endsAt;
      pending.requestedAt = new Date();
      pending.decidedAt = null;
      pending.decisionNote = '';
    } else {
      // * Always create a fresh pending request (e.g. Aug 1 and Aug 3 separately).
      profile.leaveRequests.push({
        reason: leaveReason,
        startsAt,
        endsAt,
        requestedAt: new Date(),
        decidedAt: null,
        decisionNote: '',
        status: LEAVE_REQ.PENDING,
      });
    }

    reconcileLeaveCollabStatus(profile);
    profile.markModified('leaveRequests');
    await profile.save();
    const educator = await User.findById(userId).select('fullName');
    const institute = await User.findById(profile.instituteId).select(
      'email instituteName fullName',
    );
    void mailService.notifyLeaveRequested({
      to: institute?.email,
      educatorName: educator?.fullName || 'An educator',
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
      leaveStartsAt,
      leaveEndsAt,
    });
    return profile;
  }

  /**
   * Educator cancels a pending leave request.
   * @param {{ userId: string, profileId: string, leaveRequestId?: string }} input
   */
  async cancelLeaveRequest({ userId, profileId, leaveRequestId }) {
    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
    });
    if (!profile) {
      throw new AppError('Collaboration not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'COLLAB_NOT_FOUND',
      });
    }

    ensureLeaveRequestsMigrated(profile);
    const pending = findLeaveRequest(
      profile,
      leaveRequestId,
      LEAVE_REQ.PENDING,
    );
    pending.status = LEAVE_REQ.CANCELLED;
    pending.decidedAt = new Date();
    pending.decisionNote = 'Cancelled by educator.';
    reconcileLeaveCollabStatus(profile);
    profile.markModified('leaveRequests');
    await profile.save();
    return profile;
  }

  /**
   * Educator requests permanent resignation (notice starts only after accept).
   * @param {{ userId: string, profileId: string, reason: string }} input
   */
  async requestResign({ userId, profileId, reason }) {
    let resignReason;
    try {
      resignReason = requireReason(reason, 'Resign reason');
    } catch (error) {
      rethrowReasonError(error);
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
    });
    if (!profile) {
      throw new AppError('Collaboration not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'COLLAB_NOT_FOUND',
      });
    }

    await syncProfileLifecycle(profile);

    const canResign =
      profile.status === EDUCATOR_PROFILE_STATUSES.ACTIVE ||
      profile.status === EDUCATOR_PROFILE_STATUSES.ON_LEAVE ||
      profile.status === EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING;

    if (!canResign) {
      throw new AppError(
        'Resign can only be requested while active, on leave, or with a pending leave request.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'RESIGN_NOT_ALLOWED' },
      );
    }

    // * Resign cancels any pending leave requests; approved leave may remain in history.
    ensureLeaveRequestsMigrated(profile);
    for (const row of profile.leaveRequests) {
      if (row.status === LEAVE_REQ.PENDING) {
        row.status = LEAVE_REQ.CANCELLED;
        row.decidedAt = new Date();
        row.decisionNote = 'Cancelled because resign was requested.';
      }
    }
    syncLeaveRequestsAndLegacy(profile);
    profile.markModified('leaveRequests');

    profile.previousStatus =
      profile.status === EDUCATOR_PROFILE_STATUSES.ON_LEAVE
        ? EDUCATOR_PROFILE_STATUSES.ON_LEAVE
        : EDUCATOR_PROFILE_STATUSES.ACTIVE;

    profile.status = EDUCATOR_PROFILE_STATUSES.RESIGN_PENDING;
    profile.resignReason = resignReason;
    profile.resignRequestedAt = new Date();
    profile.resignDecidedAt = null;
    profile.resignDecisionNote = '';
    profile.noticeStartedAt = null;
    profile.noticeEndsAt = null;
    profile.noticeDays = null;
    await profile.save();
    const educator = await User.findById(userId).select('fullName');
    const institute = await User.findById(profile.instituteId).select(
      'email instituteName fullName',
    );
    void mailService.notifyResignRequested({
      to: institute?.email,
      educatorName: educator?.fullName || 'An educator',
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
    });
    return profile;
  }

  /**
   * Educator cancels a pending resign request (before institute accepts).
   * @param {{ userId: string, profileId: string }} input
   */
  async cancelResignRequest({ userId, profileId }) {
    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      status: EDUCATOR_PROFILE_STATUSES.RESIGN_PENDING,
    });
    if (!profile) {
      throw new AppError(
        'Pending resign request not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'RESIGN_NOT_FOUND' },
      );
    }

    const restore =
      profile.previousStatus === EDUCATOR_PROFILE_STATUSES.ON_LEAVE
        ? EDUCATOR_PROFILE_STATUSES.ON_LEAVE
        : EDUCATOR_PROFILE_STATUSES.ACTIVE;
    profile.status = restore;
    profile.previousStatus = '';
    clearResignPendingFields(profile);
    reconcileLeaveCollabStatus(profile);
    await profile.save();
    return profile;
  }

  /**
   * Institute accepts or rejects a leave request.
   * @param {{
   *   actor: import('mongoose').Document,
   *   instituteId: string,
   *   profileId: string,
   *   decision: 'accept' | 'reject',
   *   note?: string,
   *   leaveRequestId?: string,
   * }} input
   */
  async decideLeave({
    actor,
    instituteId,
    profileId,
    decision,
    note,
    leaveRequestId,
  }) {
    assertCanDecideHr(actor);

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
    });
    if (!profile) {
      throw new AppError(
        'Pending leave request not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'LEAVE_NOT_FOUND' },
      );
    }

    ensureLeaveRequestsMigrated(profile);
    const pending = findLeaveRequest(
      profile,
      leaveRequestId,
      LEAVE_REQ.PENDING,
    );
    const decisionNote = String(note || '').trim().slice(0, 500);

    if (decision === 'reject') {
      pending.status = LEAVE_REQ.REJECTED;
      pending.decidedAt = new Date();
      pending.decisionNote = decisionNote || 'Leave request rejected.';
      reconcileLeaveCollabStatus(profile);
      profile.markModified('leaveRequests');
      await profile.save();
      const educator = await User.findById(profile.userId).select('email');
      const institute = await User.findById(instituteId).select(
        'instituteName fullName',
      );
      void mailService.notifyLeaveDecided({
        to: educator?.email,
        instituteName:
          institute?.instituteName || institute?.fullName || 'Institute',
        accepted: false,
      });
      return profile;
    }

    if (decision !== 'accept') {
      throw new AppError('Invalid leave decision.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_DECISION',
      });
    }

    pending.status = LEAVE_REQ.APPROVED;
    pending.decidedAt = new Date();
    pending.decisionNote = decisionNote;
    reconcileLeaveCollabStatus(profile);
    profile.markModified('leaveRequests');
    await profile.save();
    const educator = await User.findById(profile.userId).select('email');
    const institute = await User.findById(instituteId).select(
      'instituteName fullName',
    );
    void mailService.notifyLeaveDecided({
      to: educator?.email,
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
      accepted: true,
    });
    return profile;
  }

  /**
   * Institute accepts or rejects a resign request.
   * Accept starts the 14-day notice period.
   * @param {{
   *   actor: import('mongoose').Document,
   *   instituteId: string,
   *   profileId: string,
   *   decision: 'accept' | 'reject',
   *   note?: string,
   * }} input
   */
  async decideResign({ actor, instituteId, profileId, decision, note }) {
    assertCanDecideHr(actor);

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.RESIGN_PENDING,
    });
    if (!profile) {
      throw new AppError(
        'Pending resign request not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'RESIGN_NOT_FOUND' },
      );
    }

    const decisionNote = String(note || '').trim().slice(0, 500);
    profile.resignDecidedAt = new Date();
    profile.resignDecisionNote = decisionNote;

    if (decision === 'reject') {
      const restore =
        profile.previousStatus === EDUCATOR_PROFILE_STATUSES.ON_LEAVE
          ? EDUCATOR_PROFILE_STATUSES.ON_LEAVE
          : EDUCATOR_PROFILE_STATUSES.ACTIVE;
      profile.status = restore;
      profile.previousStatus = '';
      clearResignPendingFields(profile);
      profile.resignDecidedAt = new Date();
      profile.resignDecisionNote = decisionNote || 'Resign request rejected.';
      await profile.save();
      const educator = await User.findById(profile.userId).select('email');
      const institute = await User.findById(instituteId).select(
        'instituteName fullName',
      );
      void mailService.notifyResignDecided({
        to: educator?.email,
        instituteName:
          institute?.instituteName || institute?.fullName || 'Institute',
        accepted: false,
      });
      return profile;
    }

    if (decision !== 'accept') {
      throw new AppError('Invalid resign decision.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_DECISION',
      });
    }

    const now = new Date();
    profile.status = EDUCATOR_PROFILE_STATUSES.NOTICE_PERIOD;
    profile.previousStatus = '';
    profile.noticeDays = DEFAULT_RESIGN_NOTICE_DAYS;
    profile.noticeStartedAt = now;
    profile.noticeEndsAt = addDays(now, DEFAULT_RESIGN_NOTICE_DAYS);
    clearLeaveFields(profile);
    await profile.save();
    const educator = await User.findById(profile.userId).select('email');
    const institute = await User.findById(instituteId).select(
      'instituteName fullName',
    );
    void mailService.notifyResignDecided({
      to: educator?.email,
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
      accepted: true,
    });
    return profile;
  }

  /**
   * Institute fires / releases faculty immediately (no educator confirm).
   * @param {{
   *   actor: import('mongoose').Document,
   *   instituteId: string,
   *   profileId: string,
   *   reason: string,
   * }} input
   */
  async fireEducator({ actor, instituteId, profileId, reason }) {
    assertCanDecideHr(actor);

    let exitReason;
    try {
      exitReason = requireReason(reason, 'Fire / release reason');
    } catch (error) {
      rethrowReasonError(error);
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: {
        $in: [
          EDUCATOR_PROFILE_STATUSES.ACTIVE,
          EDUCATOR_PROFILE_STATUSES.LEAVE_PENDING,
          EDUCATOR_PROFILE_STATUSES.ON_LEAVE,
          EDUCATOR_PROFILE_STATUSES.RESIGN_PENDING,
          EDUCATOR_PROFILE_STATUSES.NOTICE_PERIOD,
          EDUCATOR_PROFILE_STATUSES.SUSPENDED,
        ],
      },
    });
    if (!profile) {
      throw new AppError(
        'Active collaboration not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'COLLAB_NOT_FOUND' },
      );
    }

    const educator = await User.findById(profile.userId).select('email');
    const institute = await User.findById(instituteId).select(
      'instituteName fullName',
    );
    void mailService.notifyFacultyReleased({
      to: educator?.email,
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
      reason: exitReason,
    });

    return markEnded(profile, {
      endedBy: EXIT_ENDED_BY.INSTITUTE_FIRE,
      exitReason,
    });
  }

  /**
   * Institute may end notice early (release now).
   * @param {{
   *   actor: import('mongoose').Document,
   *   instituteId: string,
   *   profileId: string,
   *   reason: string,
   * }} input
   */
  async releaseDuringNotice({ actor, instituteId, profileId, reason }) {
    assertCanDecideHr(actor);

    let exitReason;
    try {
      exitReason = requireReason(reason, 'Release reason');
    } catch (error) {
      rethrowReasonError(error);
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.NOTICE_PERIOD,
    });
    if (!profile) {
      throw new AppError(
        'Notice-period collaboration not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'NOTICE_NOT_FOUND' },
      );
    }

    const educator = await User.findById(profile.userId).select('email');
    const institute = await User.findById(instituteId).select(
      'instituteName fullName',
    );
    void mailService.notifyFacultyReleased({
      to: educator?.email,
      instituteName:
        institute?.instituteName || institute?.fullName || 'Institute',
      reason: exitReason,
    });

    return markEnded(profile, {
      endedBy: EXIT_ENDED_BY.INSTITUTE_ACCEPTED_RESIGN,
      exitReason,
    });
  }
}

module.exports = {
  educatorHrService: new EducatorHrService(),
  syncProfileLifecycle,
  findOpenCollab,
  markEnded,
  OPEN_COLLAB_STATUSES,
  ENTERABLE_COLLAB_STATUSES,
  DEFAULT_RESIGN_NOTICE_DAYS,
};
