'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { User } = require('../auth/user.model');
const {
  ACCOUNT_STATUS,
  APP_ROLES,
  ROLE_DEFAULT_PERMISSIONS,
  isLearnerRole,
} = require('../auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
  INSTITUTE_STAFF_ROLES,
} = require('./educator-profile.model');
const { normalizeInstituteCode, ensureInstituteCode } = require('./institute-code.util');
const { signAccessToken } = require('../../common/utils/jwt');
const { mailService } = require('../../common/mail/mail.service');
const {
  InstituteRole,
} = require('../institute-team/institute-role.model');
const {
  syncProfileLifecycle,
  findOpenCollab,
  ENTERABLE_COLLAB_STATUSES,
} = require('./educator-hr.service');
const { OPEN_COLLAB_STATUSES } = require('./educator-hr.constants');

/**
 * @param {import('mongoose').Document} profile
 * @param {import('mongoose').Document | null} institute
 * @param {{ customRoleName?: string }} [extras]
 */
function toProfileSummary(profile, institute = null, extras = {}) {
  const json = profile.toJSON();
  return {
    id: json.id,
    type: json.type,
    status: json.status,
    instituteId: json.instituteId ? String(json.instituteId) : undefined,
    instituteName:
      institute?.instituteName || institute?.fullName || undefined,
    instituteLogoPath: institute?.instituteLogoPath || undefined,
    instituteCode: institute?.instituteCode || undefined,
    permissions: Array.isArray(json.permissions) ? json.permissions : [],
    staffRole: json.staffRole || undefined,
    customRoleId: json.customRoleId ? String(json.customRoleId) : undefined,
    customRoleName: extras.customRoleName || undefined,
    displayName: json.displayName || undefined,
    examGoals: Array.isArray(json.examGoals) ? json.examGoals : [],
    profilePhotoPath: json.profilePhotoPath || undefined,
    joinSource: json.joinSource || undefined,
    invitedByUserId: json.invitedByUserId
      ? String(json.invitedByUserId)
      : undefined,
    createdAt: json.createdAt,
    activatedAt: json.activatedAt || undefined,
    rejectionReason: json.rejectionReason || undefined,
    reviewedAt: json.reviewedAt || undefined,
    leaveReason: json.leaveReason || undefined,
    leaveStartsAt: json.leaveStartsAt || undefined,
    leaveEndsAt: json.leaveEndsAt || undefined,
    leaveRequestedAt: json.leaveRequestedAt || undefined,
    leaveRequests: Array.isArray(json.leaveRequests)
      ? json.leaveRequests
          .map((row) => {
            const id = row.id || row._id;
            if (!id) {
              return null;
            }
            return {
              id: String(id),
              reason: row.reason || undefined,
              startsAt: row.startsAt || undefined,
              endsAt: row.endsAt || undefined,
              requestedAt: row.requestedAt || undefined,
              decidedAt: row.decidedAt || undefined,
              decisionNote: row.decisionNote || undefined,
              status: row.status,
            };
          })
          .filter(Boolean)
      : [],
    resignReason: json.resignReason || undefined,
    resignRequestedAt: json.resignRequestedAt || undefined,
    noticeStartedAt: json.noticeStartedAt || undefined,
    noticeEndsAt: json.noticeEndsAt || undefined,
    noticeDays: json.noticeDays ?? undefined,
    exitReason: json.exitReason || undefined,
    endedAt: json.endedAt || undefined,
    endedBy: json.endedBy || undefined,
  };
}

/**
 * Loads non-deleted educator profiles for a user with institute branding.
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
async function listProfilesForUser(userId) {
  const profiles = await EducatorProfile.find({
    userId,
    status: {
      $nin: [
        EDUCATOR_PROFILE_STATUSES.DELETED,
        EDUCATOR_PROFILE_STATUSES.ENDED,
      ],
    },
  }).sort({ createdAt: 1 });

  await Promise.all(profiles.map((profile) => syncProfileLifecycle(profile)));

  const liveProfiles = profiles.filter(
    (row) =>
      row.status !== EDUCATOR_PROFILE_STATUSES.DELETED &&
      row.status !== EDUCATOR_PROFILE_STATUSES.ENDED &&
      row.status !== EDUCATOR_PROFILE_STATUSES.REJECTED,
  );

  const instituteIds = [
    ...new Set(
      liveProfiles
        .filter((row) => row.type === EDUCATOR_PROFILE_TYPES.INSTITUTE && row.instituteId)
        .map((row) => String(row.instituteId)),
    ),
  ];

  /** @type {Map<string, import('mongoose').Document>} */
  const instituteMap = new Map();
  if (instituteIds.length > 0) {
    const institutes = await User.find({
      _id: { $in: instituteIds },
      role: APP_ROLES.INSTITUTE,
    }).select('instituteName fullName instituteLogoPath instituteCode');
    for (const row of institutes) {
      instituteMap.set(String(row._id), row);
    }
  }

  const customRoleIds = [
    ...new Set(
      liveProfiles
        .filter((row) => row.customRoleId)
        .map((row) => String(row.customRoleId)),
    ),
  ];
  /** @type {Map<string, string>} */
  const customRoleNameMap = new Map();
  if (customRoleIds.length > 0) {
    const roles = await InstituteRole.find({
      _id: { $in: customRoleIds },
    }).select('name');
    for (const row of roles) {
      customRoleNameMap.set(String(row._id), row.name);
    }
  }

  return liveProfiles.map((profile) =>
    toProfileSummary(
      profile,
      profile.instituteId
        ? instituteMap.get(String(profile.instituteId)) || null
        : null,
      {
        customRoleName: profile.customRoleId
          ? customRoleNameMap.get(String(profile.customRoleId))
          : undefined,
      },
    ),
  );
}

/**
 * @param {import('mongoose').Document} user
 * @param {ReturnType<typeof toProfileSummary>[]} profiles
 */
function resolveActiveProfileId(user, profiles) {
  const stored = user.activeProfileId ? String(user.activeProfileId) : '';
  if (stored && profiles.some((row) => row.id === stored)) {
    return stored;
  }

  const activePersonal = profiles.find(
    (row) =>
      row.type === EDUCATOR_PROFILE_TYPES.PERSONAL &&
      row.status === EDUCATOR_PROFILE_STATUSES.ACTIVE,
  );
  if (activePersonal) {
    return activePersonal.id;
  }

  const activeFreelancer = profiles.find(
    (row) =>
      row.type === EDUCATOR_PROFILE_TYPES.FREELANCER &&
      row.status === EDUCATOR_PROFILE_STATUSES.ACTIVE,
  );
  if (activeFreelancer) {
    return activeFreelancer.id;
  }

  const activeInstitute = profiles.find(
    (row) =>
      row.type === EDUCATOR_PROFILE_TYPES.INSTITUTE &&
      ENTERABLE_COLLAB_STATUSES.includes(row.status),
  );
  if (activeInstitute) {
    return activeInstitute.id;
  }

  return null;
}

/**
 * Ensures a learner has a personal (learn-home) profile for multi-profile switch.
 * @param {import('mongoose').Document} user
 */
async function ensurePersonalLearnerProfile(user) {
  if (!isLearnerRole(user.role)) {
    return null;
  }

  let personal = await EducatorProfile.findOne({
    userId: user._id,
    type: EDUCATOR_PROFILE_TYPES.PERSONAL,
    status: { $ne: EDUCATOR_PROFILE_STATUSES.DELETED },
  });

  if (personal) {
    return personal;
  }

  const examGoals = [];
  if (user.examGoal) {
    examGoals.push(String(user.examGoal));
  }
  if (Array.isArray(user.examGoals)) {
    for (const code of user.examGoals) {
      const value = String(code || '').trim();
      if (value && !examGoals.includes(value)) {
        examGoals.push(value);
      }
    }
  }

  personal = await EducatorProfile.create({
    userId: user._id,
    type: EDUCATOR_PROFILE_TYPES.PERSONAL,
    status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
    displayName: user.fullName || '',
    examGoals,
    profilePhotoPath: user.profilePhotoPath || '',
    activatedAt: new Date(),
  });

  return personal;
}

/**
 * @param {import('mongoose').Document} userDoc
 * @param {object} publicUser
 */
async function attachEducatorSession(userDoc, publicUser) {
  if (userDoc.role === APP_ROLES.INSTITUTE) {
    publicUser.instituteCode = userDoc.instituteCode || undefined;
    return publicUser;
  }

  const canHaveProfiles =
    userDoc.role === APP_ROLES.EDUCATOR || isLearnerRole(userDoc.role);

  if (!canHaveProfiles) {
    return publicUser;
  }

  if (isLearnerRole(userDoc.role)) {
    const existingCount = await EducatorProfile.countDocuments({
      userId: userDoc._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      status: {
        $nin: [
          EDUCATOR_PROFILE_STATUSES.DELETED,
          EDUCATOR_PROFILE_STATUSES.ENDED,
        ],
      },
    });
    // * Personal profile only needed once the user has institute memberships.
    if (existingCount > 0) {
      await ensurePersonalLearnerProfile(userDoc);
    }
  }

  const profiles = await listProfilesForUser(userDoc._id);
  if (profiles.length === 0) {
    return publicUser;
  }

  const activeProfileId = resolveActiveProfileId(userDoc, profiles);
  const activeProfile =
    profiles.find((row) => row.id === activeProfileId) || null;

  if (
    activeProfileId &&
    String(userDoc.activeProfileId || '') !== activeProfileId
  ) {
    userDoc.activeProfileId = activeProfileId;
    await userDoc.save();
  }

  publicUser.profiles = profiles;
  publicUser.activeProfileId = activeProfileId || undefined;
  publicUser.activeProfile = activeProfile || undefined;
  publicUser.instituteId = undefined;
  publicUser.instituteName = undefined;
  publicUser.instituteLogoPath = undefined;
  publicUser.permissions = Array.isArray(publicUser.permissions)
    ? [...publicUser.permissions]
    : [];

  if (
    activeProfile?.type === EDUCATOR_PROFILE_TYPES.INSTITUTE &&
    ENTERABLE_COLLAB_STATUSES.includes(activeProfile.status)
  ) {
    publicUser.instituteId = activeProfile.instituteId;
    publicUser.instituteName = activeProfile.instituteName;
    publicUser.instituteLogoPath = activeProfile.instituteLogoPath;
    publicUser.instituteCode = activeProfile.instituteCode;
    publicUser.permissions = activeProfile.permissions || [];
  }

  return publicUser;
}

/**
 * @param {object} publicUser
 * @returns {string}
 */
function signUserAccessToken(publicUser) {
  return signAccessToken({
    id: publicUser.id,
    role: publicUser.role,
    portal: publicUser.portal,
    accountStatus: publicUser.accountStatus,
    mobileNumber: publicUser.mobileNumber,
    activeProfileId: publicUser.activeProfileId,
  });
}

/**
 * Educator collaboration workflows (hire accept + join request + switch).
 */
class EducatorCollabService {
  /**
   * Public directory of active institutes for freelancers (code optional UX).
   * @param {{ q?: string, userId: string }} input
   */
  async listInstitutes({ q, userId }) {
    const user = await User.findById(userId);
    if (!user || user.role !== APP_ROLES.EDUCATOR || user.instituteId) {
      throw new AppError(
        'Only freelancer educators can browse institutes.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_FREELANCER' },
      );
    }

    /** @type {Record<string, unknown>} */
    const filter = {
      role: APP_ROLES.INSTITUTE,
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      instituteCode: { $exists: true, $ne: '' },
    };

    const query = String(q || '').trim();
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { instituteName: { $regex: escaped, $options: 'i' } },
        { fullName: { $regex: escaped, $options: 'i' } },
        { instituteCode: { $regex: escaped, $options: 'i' } },
      ];
    }

    const institutes = await User.find(filter)
      .select('instituteName fullName instituteLogoPath instituteCode createdAt')
      .sort({ instituteName: 1, fullName: 1 })
      .limit(50);

    const myProfiles = await EducatorProfile.find({
      userId: user._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      status: { $in: [...OPEN_COLLAB_STATUSES] },
    }).select('instituteId status');

    /** @type {Map<string, string>} */
    const myStatus = new Map(
      myProfiles.map((row) => [String(row.instituteId), row.status]),
    );

    return institutes.map((row) => {
      const id = String(row._id);
      return {
        id,
        instituteName: row.instituteName || row.fullName || 'Institute',
        instituteLogoPath: row.instituteLogoPath || undefined,
        instituteCode: row.instituteCode || undefined,
        collabStatus: myStatus.get(id) || null,
      };
    });
  }

  /**
   * Freelancer requests to join an institute by public code.
   * @param {{ userId: string, instituteCode?: string, instituteId?: string }} input
   */
  async requestJoin({ userId, instituteCode, instituteId }) {
    const user = await User.findById(userId);
    if (!user || user.role !== APP_ROLES.EDUCATOR || user.instituteId) {
      throw new AppError(
        'Only freelancer educators can request institute collaboration.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'NOT_FREELANCER' },
      );
    }

    if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
      throw new AppError(
        'Your educator account must be active first.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'ACCOUNT_NOT_ACTIVE' },
      );
    }

    const freelancer = await EducatorProfile.findOne({
      userId: user._id,
      type: EDUCATOR_PROFILE_TYPES.FREELANCER,
      status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
    });
    if (!freelancer) {
      throw new AppError(
        'Active freelancer profile required before joining an institute.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'FREELANCER_PROFILE_REQUIRED' },
      );
    }

    /** @type {import('mongoose').Document | null} */
    let institute = null;
    const id = String(instituteId || '').trim();
    if (id) {
      institute = await User.findOne({
        _id: id,
        role: APP_ROLES.INSTITUTE,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
      });
    } else {
      const code = normalizeInstituteCode(instituteCode);
      if (code.length < 4) {
        throw new AppError(
          'Enter a valid institute code or pick an institute from the list.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_INSTITUTE_CODE' },
        );
      }
      institute = await User.findOne({
        role: APP_ROLES.INSTITUTE,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        instituteCode: code,
      });
    }

    if (!institute) {
      throw new AppError(
        'No active institute found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'INSTITUTE_NOT_FOUND' },
      );
    }

    if (!String(institute.instituteCode || '').trim()) {
      await ensureInstituteCode(institute);
    }

    const existing = await findOpenCollab(user._id, institute._id);
    if (existing) {
      throw new AppError(
        existing.status === EDUCATOR_PROFILE_STATUSES.ACTIVE
          ? 'You already collaborate with this institute.'
          : 'A join request or collaboration for this institute already exists.',
        HTTP_STATUS.CONFLICT,
        { code: 'COLLAB_EXISTS' },
      );
    }

    const defaults = ROLE_DEFAULT_PERMISSIONS[APP_ROLES.EDUCATOR] || [];
    const profile = await EducatorProfile.create({
      userId: user._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId: institute._id,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      permissions: [...defaults],
      displayName: user.fullName || freelancer.displayName || '',
      examGoals: Array.isArray(user.examGoals) ? [...user.examGoals] : [],
      profilePhotoPath: user.profilePhotoPath || freelancer.profilePhotoPath || '',
      joinSource: 'educator_request',
    });

    void mailService.notifyJoinRequest({
      to: institute.email,
      educatorName: user.fullName || freelancer.displayName || 'An educator',
      instituteName: institute.instituteName || institute.fullName || 'Institute',
    });

    return toProfileSummary(profile, institute);
  }

  /**
   * Freelancer accepts an institute hire invite.
   * @param {{ userId: string, profileId: string }} input
   */
  async acceptHireInvite({ userId, profileId }) {
    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      joinSource: 'institute_hire',
    });

    if (!profile) {
      throw new AppError('Hire invite not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'INVITE_NOT_FOUND',
      });
    }

    profile.status = EDUCATOR_PROFILE_STATUSES.ACTIVE;
    profile.activatedAt = new Date();
    if (!profile.permissions?.length) {
      const defaultsRole =
        profile.staffRole === INSTITUTE_STAFF_ROLES.INSTITUTE_ADMIN
          ? APP_ROLES.INSTITUTE_ADMIN
          : APP_ROLES.EDUCATOR;
      profile.permissions = [...(ROLE_DEFAULT_PERMISSIONS[defaultsRole] || [])];
    }
    await profile.save();

    const institute = await User.findById(profile.instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode email',
    );
    const member = await User.findById(userId);
    if (member && isLearnerRole(member.role)) {
      await ensurePersonalLearnerProfile(member);
    }
    void mailService.notifyHireAccepted({
      to: institute?.email,
      educatorName: member?.fullName || 'A member',
      instituteName: institute?.instituteName || institute?.fullName || 'Institute',
    });
    return toProfileSummary(profile, institute);
  }

  /**
   * Declines a hire invite (reason required) or cancels own join request.
   * @param {{ userId: string, profileId: string, reason?: string }} input
   */
  async declineOrCancelCollab({ userId, profileId, reason }) {
    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
    });

    if (!profile) {
      throw new AppError('Pending collaboration not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'COLLAB_NOT_FOUND',
      });
    }

    const {
      normalizeReason,
      requireReason,
    } = require('./educator-hr.constants');

    if (profile.joinSource === 'institute_hire') {
      let note;
      try {
        note = requireReason(reason, 'Decline reason');
      } catch (error) {
        throw new AppError(
          error.message || 'Enter a decline reason (at least 10 characters).',
          HTTP_STATUS.BAD_REQUEST,
          { code: error.code || 'REASON_REQUIRED' },
        );
      }

      profile.status = EDUCATOR_PROFILE_STATUSES.REJECTED;
      profile.rejectionReason = note;
      profile.reviewedAt = new Date();
      await profile.save();

      const institute = await User.findById(profile.instituteId).select(
        'instituteName fullName email instituteLogoPath instituteCode',
      );
      const member = await User.findById(userId).select('fullName');
      void mailService.notifyHireDeclined({
        to: institute?.email,
        educatorName: member?.fullName || 'A member',
        instituteName:
          institute?.instituteName || institute?.fullName || 'Institute',
      });

      return toProfileSummary(profile, institute);
    }

    // * Own join-request cancel — remove from institute queue.
    profile.status = EDUCATOR_PROFILE_STATUSES.DELETED;
    const note = normalizeReason(reason);
    if (note) {
      profile.rejectionReason = note;
      profile.reviewedAt = new Date();
    }
    await profile.save();
    return { id: String(profile._id), deleted: true };
  }

  /**
   * Switches the active educator profile and returns a fresh session.
   * @param {{
   *   userId: string,
   *   profileId: string,
   *   toPublicUser: Function,
   * }} input
   */
  async switchProfile({ userId, profileId, toPublicUser }) {
    const user = await User.findById(userId);
    if (
      !user ||
      (user.role !== APP_ROLES.EDUCATOR && !isLearnerRole(user.role))
    ) {
      throw new AppError(
        'Only users with multiple profiles can switch.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'PROFILE_SWITCH_FORBIDDEN' },
      );
    }

    if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
      throw new AppError(
        'Your account must be active to switch profiles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'ACCOUNT_NOT_ACTIVE' },
      );
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      userId: user._id,
      status: {
        $in: [
          EDUCATOR_PROFILE_STATUSES.ACTIVE,
          ...ENTERABLE_COLLAB_STATUSES,
        ],
      },
    });

    if (!profile) {
      throw new AppError(
        'Active profile not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'PROFILE_NOT_FOUND' },
      );
    }

    if (
      profile.type === EDUCATOR_PROFILE_TYPES.INSTITUTE &&
      !ENTERABLE_COLLAB_STATUSES.includes(profile.status)
    ) {
      throw new AppError(
        'Active profile not found.',
        HTTP_STATUS.NOT_FOUND,
        { code: 'PROFILE_NOT_FOUND' },
      );
    }

    user.activeProfileId = profile._id;
    await user.save();

    let publicUser = toPublicUser(user);
    publicUser = await attachEducatorSession(user, publicUser);
    const accessToken = signUserAccessToken(publicUser);

    return { accessToken, user: publicUser };
  }
}

module.exports = {
  educatorCollabService: new EducatorCollabService(),
  listProfilesForUser,
  attachEducatorSession,
  ensurePersonalLearnerProfile,
  toProfileSummary,
  signUserAccessToken,
  resolveActiveProfileId,
};
