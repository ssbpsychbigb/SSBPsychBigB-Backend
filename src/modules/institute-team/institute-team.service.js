'use strict';

const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const {
  normalizeMobile,
  isValidIndianMobile,
} = require('../../common/utils/otp');
const { User } = require('../auth/user.model');
const { toPublicUser } = require('../auth/auth.service');
const {
  APP_ROLES,
  ACCOUNT_STATUS,
  ASSIGNABLE_INSTITUTE_ROLES,
  INSTITUTE_PERMISSIONS,
  INSTITUTE_PERMISSION_META,
  ROLE_DEFAULT_PERMISSIONS,
  PORTAL,
  EXAM_GOAL_CODES,
} = require('../auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
} = require('../educator-profile/educator-profile.model');
const { toProfileSummary } = require('../educator-profile/educator-collab.service');
const { ensureInstituteCode } = require('../educator-profile/institute-code.util');
const {
  educatorHrService,
  syncProfileLifecycle,
  findOpenCollab,
  OPEN_COLLAB_STATUSES,
} = require('../educator-profile/educator-hr.service');
const { mailService } = require('../../common/mail/mail.service');

const ALL_INSTITUTE_PERMISSION_CODES = new Set(
  Object.values(INSTITUTE_PERMISSIONS),
);
const ALL_EXAM_GOAL_CODES = new Set(EXAM_GOAL_CODES);

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function sanitizeInstitutePermissions(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set();
  for (const code of input) {
    const value = String(code || '').trim();
    if (ALL_INSTITUTE_PERMISSION_CODES.has(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function sanitizeExamGoals(input) {
  let list = input;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      list = Array.isArray(parsed) ? parsed : trimmed.split(',');
    } catch {
      list = trimmed.split(',');
    }
  }

  if (!Array.isArray(list)) {
    return [];
  }

  const unique = new Set();
  for (const code of list) {
    const value = String(code || '').trim().toLowerCase();
    if (ALL_EXAM_GOAL_CODES.has(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

/**
 * @param {unknown} input
 * @returns {string[] | undefined}
 */
function parsePermissionsField(input) {
  if (input === undefined || input === null || input === '') {
    return undefined;
  }

  if (Array.isArray(input)) {
    return sanitizeInstitutePermissions(input);
  }

  if (typeof input === 'string') {
    try {
      return sanitizeInstitutePermissions(JSON.parse(input));
    } catch {
      return sanitizeInstitutePermissions(input.split(','));
    }
  }

  return [];
}

/**
 * @param {import('mongoose').Document} actor
 * @returns {string[]}
 */
function resolveActorPermissions(actor) {
  if (actor.role === APP_ROLES.INSTITUTE) {
    return [...(ROLE_DEFAULT_PERMISSIONS[APP_ROLES.INSTITUTE] || [])];
  }

  return Array.isArray(actor.permissions) ? [...actor.permissions] : [];
}

/**
 * @param {import('mongoose').Document} actor
 * @returns {string}
 */
function resolveActorInstituteId(actor) {
  if (actor.role === APP_ROLES.INSTITUTE) {
    return String(actor._id);
  }

  if (
    (actor.role === APP_ROLES.INSTITUTE_ADMIN ||
      actor.role === APP_ROLES.EDUCATOR) &&
    actor.instituteId
  ) {
    return String(actor.instituteId);
  }

  throw new AppError(
    'Only institute owners and institute team members can access this.',
    HTTP_STATUS.FORBIDDEN,
    { code: 'NOT_INSTITUTE_CONTEXT' },
  );
}

/**
 * @param {import('mongoose').Document} actor
 * @param {string} permission
 */
function assertActorHasPermission(actor, permission) {
  if (actor.role === APP_ROLES.INSTITUTE) {
    return;
  }

  const granted = new Set(resolveActorPermissions(actor));
  if (!granted.has(permission)) {
    throw new AppError(
      'You do not have permission for this institute action.',
      HTTP_STATUS.FORBIDDEN,
      { code: 'INSTITUTE_FORBIDDEN', details: { required: permission } },
    );
  }
}

/**
 * @param {import('mongoose').Document} member
 */
function toTeamMember(member) {
  const user = toPublicUser(member);
  return {
    ...user,
    instituteId: user.instituteId,
    invitedByUserId: user.invitedByUserId,
    membershipKind: 'legacy',
  };
}

/**
 * Profile-backed collab row for institute team directory.
 * @param {import('mongoose').Document} profile
 * @param {import('mongoose').Document} memberUser
 * @param {import('mongoose').Document | null} institute
 */
function toProfileTeamMember(profile, memberUser, institute) {
  const summary = toProfileSummary(profile, institute);
  const user = toPublicUser(memberUser);
  return {
    ...user,
    id: summary.id,
    userId: user.id,
    role: APP_ROLES.EDUCATOR,
    accountStatus: summary.status,
    instituteId: summary.instituteId,
    permissions: summary.permissions,
    examGoals: summary.examGoals,
    profilePhotoPath: summary.profilePhotoPath || user.profilePhotoPath,
    invitedByUserId: summary.invitedByUserId,
    joinSource: summary.joinSource,
    membershipKind: 'profile',
    createdAt: summary.createdAt,
    leaveReason: summary.leaveReason,
    leaveStartsAt: summary.leaveStartsAt,
    leaveEndsAt: summary.leaveEndsAt,
    leaveRequestedAt: summary.leaveRequestedAt,
    resignReason: summary.resignReason,
    resignRequestedAt: summary.resignRequestedAt,
    noticeStartedAt: summary.noticeStartedAt,
    noticeEndsAt: summary.noticeEndsAt,
    noticeDays: summary.noticeDays,
    exitReason: summary.exitReason,
    endedAt: summary.endedAt,
    endedBy: summary.endedBy,
  };
}

/**
 * Institute-scoped team directory — invite Institute Admins & Educators (OTP).
 */
class InstituteTeamService {
  getPermissionCatalog() {
    const permissions = Object.values(INSTITUTE_PERMISSIONS).map((code) => ({
      code,
      ...(INSTITUTE_PERMISSION_META[code] || {
        label: code,
        description: '',
        group: 'Other',
      }),
    }));

    return {
      permissions,
      roleDefaults: {
        [APP_ROLES.INSTITUTE_ADMIN]: [
          ...(ROLE_DEFAULT_PERMISSIONS[APP_ROLES.INSTITUTE_ADMIN] || []),
        ],
        [APP_ROLES.EDUCATOR]: [
          ...(ROLE_DEFAULT_PERMISSIONS[APP_ROLES.EDUCATOR] || []),
        ],
      },
      assignableRoles: [...ASSIGNABLE_INSTITUTE_ROLES],
    };
  }

  /**
   * @param {{ actor: import('mongoose').Document }} input
   */
  async listTeam({ actor }) {
    const instituteId = resolveActorInstituteId(actor);

    if (actor.role === APP_ROLES.EDUCATOR) {
      throw new AppError(
        'Educators cannot manage the institute team directory.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const canList =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      );

    if (!canList) {
      throw new AppError(
        'You do not have permission to view the institute team.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const members = await User.find({
      instituteId,
      role: { $in: [...ASSIGNABLE_INSTITUTE_ROLES] },
      accountStatus: { $ne: ACCOUNT_STATUS.DELETED },
    })
      .sort({ createdAt: -1 })
      .limit(300);

    const legacy = members.map(toTeamMember);
    const legacyUserIds = new Set(legacy.map((row) => row.id));

    const collabProfiles = await EducatorProfile.find({
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: { $in: [...OPEN_COLLAB_STATUSES] },
    })
      .sort({ createdAt: -1 })
      .limit(300);

    for (const profile of collabProfiles) {
      await syncProfileLifecycle(profile);
    }

    const liveCollabs = collabProfiles.filter((row) =>
      OPEN_COLLAB_STATUSES.includes(row.status),
    );

    const userIds = [
      ...new Set(liveCollabs.map((row) => String(row.userId))),
    ];
    const users =
      userIds.length > 0
        ? await User.find({ _id: { $in: userIds } })
        : [];
    /** @type {Map<string, import('mongoose').Document>} */
    const userMap = new Map(users.map((row) => [String(row._id), row]));

    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );

    const profileRows = [];
    for (const profile of liveCollabs) {
      const memberUser = userMap.get(String(profile.userId));
      if (!memberUser) {
        continue;
      }
      // * Skip legacy faculty who already appear via User.instituteId.
      if (
        memberUser.instituteId &&
        String(memberUser.instituteId) === instituteId &&
        legacyUserIds.has(String(memberUser._id))
      ) {
        continue;
      }
      profileRows.push(toProfileTeamMember(profile, memberUser, owner));
    }

    return [...profileRows, ...legacy];
  }

  /**
   * @param {{
   *   fullName: string,
   *   email: string,
   *   mobileNumber: string,
   *   role: string,
   *   permissions?: string[] | string,
   *   examGoals?: string[] | string,
   *   profilePhotoPath?: string,
   *   actor: import('mongoose').Document,
   * }} input
   */
  async inviteMember({
    fullName,
    email,
    mobileNumber,
    role,
    permissions,
    examGoals,
    profilePhotoPath,
    actor,
  }) {
    const instituteId = resolveActorInstituteId(actor);
    const nextRole = String(role || '').trim();

    if (!ASSIGNABLE_INSTITUTE_ROLES.includes(nextRole)) {
      throw new AppError(
        'Role must be institute_admin or educator.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_INSTITUTE_ROLE' },
      );
    }

    if (actor.role === APP_ROLES.EDUCATOR) {
      throw new AppError(
        'Educators cannot invite institute team members.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    if (nextRole === APP_ROLES.EDUCATOR) {
      const canAdd =
        actor.role === APP_ROLES.INSTITUTE ||
        resolveActorPermissions(actor).includes(
          INSTITUTE_PERMISSIONS.FACULTY_ADD,
        ) ||
        resolveActorPermissions(actor).includes(
          INSTITUTE_PERMISSIONS.TEAM_MANAGE,
        );
      if (!canAdd) {
        throw new AppError(
          'You do not have permission to invite educators.',
          HTTP_STATUS.FORBIDDEN,
          { code: 'INSTITUTE_FORBIDDEN' },
        );
      }
    } else {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
    }

    const owner = await User.findById(instituteId);
    if (
      !owner ||
      owner.role !== APP_ROLES.INSTITUTE ||
      owner.accountStatus !== ACCOUNT_STATUS.ACTIVE
    ) {
      throw new AppError(
        'Institute account is not active.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INSTITUTE_NOT_ACTIVE' },
      );
    }

    const name = String(fullName || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedMobile = normalizeMobile(mobileNumber);

    if (!name || name.length < 2) {
      throw new AppError('Enter a full name.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_NAME',
      });
    }

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new AppError('Enter a valid email.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_EMAIL',
      });
    }

    if (!isValidIndianMobile(normalizedMobile)) {
      throw new AppError(
        'Enter a valid 10-digit Indian mobile number.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_MOBILE' },
      );
    }

    const nextExamGoals =
      nextRole === APP_ROLES.EDUCATOR ? sanitizeExamGoals(examGoals) : [];

    if (nextRole === APP_ROLES.EDUCATOR && nextExamGoals.length === 0) {
      throw new AppError(
        'Select at least one exam this educator prepares students for.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EXAM_GOALS_REQUIRED' },
      );
    }

    const defaults = ROLE_DEFAULT_PERMISSIONS[nextRole] || [];
    const parsedPermissions = parsePermissionsField(permissions);
    let nextPermissions =
      parsedPermissions === undefined ? [...defaults] : parsedPermissions;

    // * Only actors with roles_assign (or owners) may customize away from defaults.
    const canAssignRoles =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.ROLES_ASSIGN,
      );

    if (!canAssignRoles) {
      nextPermissions = [...defaults];
    }

    const existing = await User.findOne({ mobileNumber: normalizedMobile });
    if (existing) {
      return this.#inviteExistingFreelancer({
        existing,
        nextRole,
        name,
        normalizedEmail,
        nextExamGoals,
        nextPermissions,
        profilePhotoPath,
        instituteId,
        owner,
        actor,
      });
    }

    const photoPath = String(profilePhotoPath || '').trim();

    try {
      const member = await User.create({
        fullName: name,
        email: normalizedEmail,
        mobileNumber: normalizedMobile,
        role: nextRole,
        accountStatus: ACCOUNT_STATUS.INVITED,
        isMobileVerified: false,
        mobileVerifiedAt: null,
        portal: PORTAL.APP,
        verificationLevel: 0,
        instituteId,
        invitedByUserId: actor._id,
        instituteName: owner.instituteName || owner.fullName || '',
        instituteLogoPath: owner.instituteLogoPath || '',
        permissions: nextPermissions,
        examGoals: nextExamGoals,
        profilePhotoPath: photoPath,
      });

      if (nextRole === APP_ROLES.EDUCATOR) {
        await EducatorProfile.create({
          userId: member._id,
          type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
          instituteId,
          status: EDUCATOR_PROFILE_STATUSES.INVITED,
          permissions: nextPermissions,
          displayName: name,
          examGoals: nextExamGoals,
          profilePhotoPath: photoPath,
          invitedByUserId: actor._id,
          joinSource: 'legacy_invite',
        });
      }

      return toTeamMember(member);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'This mobile number or email is already in use.',
          HTTP_STATUS.CONFLICT,
          { code: 'TEAM_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * Hires an already-registered freelancer without creating a second User.
   * @param {{
   *   existing: import('mongoose').Document,
   *   nextRole: string,
   *   name: string,
   *   normalizedEmail: string,
   *   nextExamGoals: string[],
   *   nextPermissions: string[],
   *   profilePhotoPath?: string,
   *   instituteId: string,
   *   owner: import('mongoose').Document,
   *   actor: import('mongoose').Document,
   * }} input
   */
  async #inviteExistingFreelancer({
    existing,
    nextRole,
    name,
    normalizedEmail,
    nextExamGoals,
    nextPermissions,
    profilePhotoPath,
    instituteId,
    owner,
    actor,
  }) {
    if (nextRole !== APP_ROLES.EDUCATOR) {
      throw new AppError(
        'This mobile number is already registered on BIGB.',
        HTTP_STATUS.CONFLICT,
        { code: 'MOBILE_ALREADY_REGISTERED' },
      );
    }

    const isFreelancer =
      existing.role === APP_ROLES.EDUCATOR &&
      !existing.instituteId &&
      existing.accountStatus === ACCOUNT_STATUS.ACTIVE;

    if (!isFreelancer) {
      throw new AppError(
        'This mobile number is already registered on BIGB.',
        HTTP_STATUS.CONFLICT,
        { code: 'MOBILE_ALREADY_REGISTERED' },
      );
    }

    const freelancerProfile = await EducatorProfile.findOne({
      userId: existing._id,
      type: EDUCATOR_PROFILE_TYPES.FREELANCER,
      status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
    });
    if (!freelancerProfile) {
      throw new AppError(
        'This educator is not an approved freelancer yet.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'NOT_APPROVED_FREELANCER' },
      );
    }

    const already = await findOpenCollab(existing._id, instituteId);
    if (already) {
      throw new AppError(
        already.status === EDUCATOR_PROFILE_STATUSES.ACTIVE
          ? 'This educator already collaborates with your institute.'
          : 'An invite or collaboration already exists for this educator.',
        HTTP_STATUS.CONFLICT,
        { code: 'COLLAB_EXISTS' },
      );
    }

    const photoPath =
      String(profilePhotoPath || '').trim() ||
      existing.profilePhotoPath ||
      freelancerProfile.profilePhotoPath ||
      '';

    const profile = await EducatorProfile.create({
      userId: existing._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      permissions: nextPermissions,
      displayName: name || existing.fullName || freelancerProfile.displayName,
      examGoals:
        nextExamGoals.length > 0
          ? nextExamGoals
          : Array.isArray(existing.examGoals)
            ? [...existing.examGoals]
            : [],
      profilePhotoPath: photoPath,
      invitedByUserId: actor._id,
      joinSource: 'institute_hire',
    });

    // * Keep identity email/name in sync when institute provides fresher hire details.
    if (name && name.length >= 2 && name !== existing.fullName) {
      existing.fullName = name;
    }
    if (normalizedEmail && normalizedEmail !== existing.email) {
      existing.email = normalizedEmail;
    }
    await existing.save();

    void mailService.notifyHireInvite({
      to: existing.email,
      educatorName: existing.fullName || 'there',
      instituteName: owner.instituteName || owner.fullName || 'Institute',
    });

    return toProfileTeamMember(profile, existing, owner);
  }

  /**
   * Institute accepts an educator-initiated join request.
   * @param {{ profileId: string, actor: import('mongoose').Document }} input
   */
  async acceptJoinRequest({ profileId, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const canAdd =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      );
    if (!canAdd) {
      throw new AppError(
        'You do not have permission to accept educator join requests.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      joinSource: 'educator_request',
    });

    if (!profile) {
      throw new AppError('Join request not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'JOIN_REQUEST_NOT_FOUND',
      });
    }

    profile.status = EDUCATOR_PROFILE_STATUSES.ACTIVE;
    profile.activatedAt = new Date();
    if (!profile.permissions?.length) {
      profile.permissions = [
        ...(ROLE_DEFAULT_PERMISSIONS[APP_ROLES.EDUCATOR] || []),
      ];
    }
    await profile.save();

    const memberUser = await User.findById(profile.userId);
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    if (!memberUser) {
      throw new AppError('Educator account not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    void mailService.notifyJoinAccepted({
      to: memberUser.email,
      instituteName: owner?.instituteName || owner?.fullName || 'Institute',
    });

    return toProfileTeamMember(profile, memberUser, owner);
  }

  /**
   * Institute rejects an educator-initiated join request.
   * @param {{ profileId: string, actor: import('mongoose').Document }} input
   */
  async rejectJoinRequest({ profileId, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const canAdd =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      );
    if (!canAdd) {
      throw new AppError(
        'You do not have permission to reject educator join requests.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const profile = await EducatorProfile.findOne({
      _id: profileId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      joinSource: 'educator_request',
    });

    if (!profile) {
      throw new AppError('Join request not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'JOIN_REQUEST_NOT_FOUND',
      });
    }

    profile.status = EDUCATOR_PROFILE_STATUSES.DELETED;
    await profile.save();
    const memberUser = await User.findById(profile.userId).select('email');
    const owner = await User.findById(instituteId).select(
      'instituteName fullName',
    );
    void mailService.notifyJoinRejected({
      to: memberUser?.email,
      instituteName: owner?.instituteName || owner?.fullName || 'Institute',
    });
    return { id: String(profile._id), deleted: true };
  }

  /**
   * Returns institute code for the actor's institute (owners/admins).
   * @param {{ actor: import('mongoose').Document }} input
   */
  async getInstituteCode({ actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const owner = await User.findById(instituteId);
    if (!owner || owner.role !== APP_ROLES.INSTITUTE) {
      throw new AppError('Institute not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'INSTITUTE_NOT_FOUND',
      });
    }
    const code = await ensureInstituteCode(owner);
    return {
      instituteId: String(owner._id),
      instituteName: owner.instituteName || owner.fullName || '',
      instituteCode: code,
    };
  }

  /**
   * Search approved freelancer educators to hire by name (or mobile).
   * @param {{ actor: import('mongoose').Document, q?: string }} input
   */
  async searchFreelancers({ actor, q }) {
    const instituteId = resolveActorInstituteId(actor);
    const canAdd =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      );
    if (!canAdd) {
      throw new AppError(
        'You do not have permission to hire educators.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const query = String(q || '').trim();
    /** @type {Record<string, unknown>} */
    const userFilter = {
      role: APP_ROLES.EDUCATOR,
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      instituteId: null,
    };

    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const digits = query.replace(/\D/g, '');
      userFilter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
      if (digits.length >= 4) {
        userFilter.$or.push({
          mobileNumber: { $regex: digits, $options: 'i' },
        });
      }
    }

    const candidates = await User.find(userFilter)
      .select(
        'fullName email mobileNumber examGoals profilePhotoPath verificationLevel',
      )
      .sort({ fullName: 1 })
      .limit(40);

    if (candidates.length === 0) {
      return [];
    }

    const userIds = candidates.map((row) => row._id);
    const freelancerProfiles = await EducatorProfile.find({
      userId: { $in: userIds },
      type: EDUCATOR_PROFILE_TYPES.FREELANCER,
      status: EDUCATOR_PROFILE_STATUSES.ACTIVE,
    }).select('userId');

    const approvedIds = new Set(
      freelancerProfiles.map((row) => String(row.userId)),
    );

    const existingCollabs = await EducatorProfile.find({
      userId: { $in: userIds },
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: { $in: [...OPEN_COLLAB_STATUSES] },
    }).select('userId status');

    /** @type {Map<string, string>} */
    const collabStatus = new Map(
      existingCollabs.map((row) => [String(row.userId), row.status]),
    );

    return candidates
      .filter((row) => approvedIds.has(String(row._id)))
      .map((row) => {
        const id = String(row._id);
        return {
          id,
          fullName: row.fullName || '',
          email: row.email || '',
          mobileNumber: row.mobileNumber || '',
          examGoals: Array.isArray(row.examGoals) ? row.examGoals : [],
          profilePhotoPath: row.profilePhotoPath || undefined,
          verificationLevel: row.verificationLevel || 0,
          collabStatus: collabStatus.get(id) || null,
        };
      });
  }

  /**
   * Hire a freelancer by user id (name-picker path — mobile optional on UI).
   * @param {{
   *   actor: import('mongoose').Document,
   *   freelancerUserId: string,
   *   permissions?: string[] | string,
   *   examGoals?: string[] | string,
   * }} input
   */
  async hireFreelancerById({
    actor,
    freelancerUserId,
    permissions,
    examGoals,
  }) {
    const instituteId = resolveActorInstituteId(actor);
    const canAdd =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      );
    if (!canAdd) {
      throw new AppError(
        'You do not have permission to hire educators.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const owner = await User.findById(instituteId);
    if (
      !owner ||
      owner.role !== APP_ROLES.INSTITUTE ||
      owner.accountStatus !== ACCOUNT_STATUS.ACTIVE
    ) {
      throw new AppError(
        'Institute account is not active.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INSTITUTE_NOT_ACTIVE' },
      );
    }

    const existing = await User.findById(freelancerUserId);
    if (!existing) {
      throw new AppError('Educator not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    const defaults = ROLE_DEFAULT_PERMISSIONS[APP_ROLES.EDUCATOR] || [];
    const parsedPermissions = parsePermissionsField(permissions);
    let nextPermissions =
      parsedPermissions === undefined ? [...defaults] : parsedPermissions;

    const canAssignRoles =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.ROLES_ASSIGN,
      );
    if (!canAssignRoles) {
      nextPermissions = [...defaults];
    }

    const nextExamGoals = sanitizeExamGoals(
      examGoals !== undefined ? examGoals : existing.examGoals,
    );
    const resolvedExamGoals =
      nextExamGoals.length > 0
        ? nextExamGoals
        : Array.isArray(existing.examGoals)
          ? [...existing.examGoals]
          : [];

    if (resolvedExamGoals.length === 0) {
      throw new AppError(
        'This educator has no exam goals on file. Ask them to update their profile, or hire via full invite form.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EXAM_GOALS_REQUIRED' },
      );
    }

    return this.#inviteExistingFreelancer({
      existing,
      nextRole: APP_ROLES.EDUCATOR,
      name: existing.fullName || 'Educator',
      normalizedEmail: existing.email,
      nextExamGoals: resolvedExamGoals,
      nextPermissions,
      profilePhotoPath: existing.profilePhotoPath || '',
      instituteId,
      owner,
      actor,
    });
  }

  /**
   * @param {{
   *   memberId: string,
   *   fullName?: string,
   *   permissions?: string[] | string,
   *   examGoals?: string[] | string,
   *   profilePhotoPath?: string,
   *   accountStatus?: string,
   *   actor: import('mongoose').Document,
   * }} input
   */
  async updateMember({
    memberId,
    fullName,
    permissions,
    examGoals,
    profilePhotoPath,
    accountStatus,
    actor,
  }) {
    const instituteId = resolveActorInstituteId(actor);

    if (actor.role === APP_ROLES.EDUCATOR) {
      throw new AppError(
        'Educators cannot update institute team members.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const member = await User.findById(memberId);
    if (
      !member ||
      member.accountStatus === ACCOUNT_STATUS.DELETED ||
      !member.instituteId ||
      String(member.instituteId) !== instituteId
    ) {
      throw new AppError('Team member not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    if (!ASSIGNABLE_INSTITUTE_ROLES.includes(member.role)) {
      throw new AppError('Team member not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    if (String(member._id) === String(actor._id)) {
      throw new AppError(
        'You cannot edit your own team account here.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_EDIT_SELF' },
      );
    }

    if (fullName !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      const name = String(fullName || '').trim();
      if (!name || name.length < 2) {
        throw new AppError('Enter a full name.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_NAME',
        });
      }
      member.fullName = name;
    }

    if (permissions !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.ROLES_ASSIGN);
      const parsed = parsePermissionsField(permissions);
      member.permissions = parsed || [];
    }

    if (examGoals !== undefined) {
      if (member.role !== APP_ROLES.EDUCATOR) {
        throw new AppError(
          'Exam goals apply only to educators.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EXAM_GOALS_ROLE' },
        );
      }
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      const nextExamGoals = sanitizeExamGoals(examGoals);
      if (nextExamGoals.length === 0) {
        throw new AppError(
          'Select at least one exam this educator prepares students for.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EXAM_GOALS_REQUIRED' },
        );
      }
      member.examGoals = nextExamGoals;
    }

    if (profilePhotoPath !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      member.profilePhotoPath = String(profilePhotoPath || '').trim();
    }

    if (accountStatus !== undefined) {
      const nextStatus = String(accountStatus || '').trim();
      if (
        nextStatus !== ACCOUNT_STATUS.ACTIVE &&
        nextStatus !== ACCOUNT_STATUS.SUSPENDED &&
        nextStatus !== ACCOUNT_STATUS.INVITED
      ) {
        throw new AppError(
          'Status must be active, invited, or suspended.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_STATUS' },
        );
      }

      if (member.role === APP_ROLES.EDUCATOR) {
        const canRemove =
          actor.role === APP_ROLES.INSTITUTE ||
          resolveActorPermissions(actor).includes(
            INSTITUTE_PERMISSIONS.FACULTY_REMOVE,
          ) ||
          resolveActorPermissions(actor).includes(
            INSTITUTE_PERMISSIONS.TEAM_MANAGE,
          );
        if (!canRemove) {
          throw new AppError(
            'You do not have permission to change educator status.',
            HTTP_STATUS.FORBIDDEN,
            { code: 'INSTITUTE_FORBIDDEN' },
          );
        }
      } else {
        assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      }

      // * Invited stays invited until first OTP; cannot force-active without OTP.
      if (
        nextStatus === ACCOUNT_STATUS.ACTIVE &&
        !member.isMobileVerified
      ) {
        throw new AppError(
          'Member must complete mobile OTP login before becoming active.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'OTP_REQUIRED' },
        );
      }

      member.accountStatus = nextStatus;
    }

    await member.save();
    return toTeamMember(member);
  }

  /**
   * Soft-delete — removes from team and blocks OTP login.
   *
   * @param {{ memberId: string, actor: import('mongoose').Document }} input
   */
  async removeMember({ memberId, actor }) {
    const instituteId = resolveActorInstituteId(actor);

    if (actor.role === APP_ROLES.EDUCATOR) {
      throw new AppError(
        'Educators cannot remove institute team members.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const member = await User.findById(memberId);
    if (
      !member ||
      member.accountStatus === ACCOUNT_STATUS.DELETED ||
      !member.instituteId ||
      String(member.instituteId) !== instituteId
    ) {
      throw new AppError('Team member not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    if (!ASSIGNABLE_INSTITUTE_ROLES.includes(member.role)) {
      throw new AppError('Team member not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    if (String(member._id) === String(actor._id)) {
      throw new AppError(
        'You cannot remove your own account.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'CANNOT_REMOVE_SELF' },
      );
    }

    if (member.role === APP_ROLES.EDUCATOR) {
      const canRemove =
        actor.role === APP_ROLES.INSTITUTE ||
        resolveActorPermissions(actor).includes(
          INSTITUTE_PERMISSIONS.FACULTY_REMOVE,
        ) ||
        resolveActorPermissions(actor).includes(
          INSTITUTE_PERMISSIONS.TEAM_MANAGE,
        );
      if (!canRemove) {
        throw new AppError(
          'You do not have permission to remove educators.',
          HTTP_STATUS.FORBIDDEN,
          { code: 'INSTITUTE_FORBIDDEN' },
        );
      }
    } else {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
    }

    member.accountStatus = ACCOUNT_STATUS.DELETED;
    await member.save();
    return toTeamMember(member);
  }

  /**
   * @param {{ profileId: string, decision: 'accept'|'reject', note?: string, actor: import('mongoose').Document }} input
   */
  async decideLeaveRequest({ profileId, decision, note, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const profile = await educatorHrService.decideLeave({
      actor,
      instituteId,
      profileId,
      decision,
      note,
    });
    const memberUser = await User.findById(profile.userId);
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    if (!memberUser) {
      throw new AppError('Educator not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    return toProfileTeamMember(profile, memberUser, owner);
  }

  /**
   * @param {{ profileId: string, decision: 'accept'|'reject', note?: string, actor: import('mongoose').Document }} input
   */
  async decideResignRequest({ profileId, decision, note, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const profile = await educatorHrService.decideResign({
      actor,
      instituteId,
      profileId,
      decision,
      note,
    });
    const memberUser = await User.findById(profile.userId);
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    if (!memberUser) {
      throw new AppError('Educator not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    return toProfileTeamMember(profile, memberUser, owner);
  }

  /**
   * Immediate fire / release for profile-backed faculty.
   * @param {{ profileId: string, reason: string, actor: import('mongoose').Document }} input
   */
  async fireProfileMember({ profileId, reason, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const profile = await educatorHrService.fireEducator({
      actor,
      instituteId,
      profileId,
      reason,
    });
    const memberUser = await User.findById(profile.userId);
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    if (!memberUser) {
      throw new AppError('Educator not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    return toProfileTeamMember(profile, memberUser, owner);
  }

  /**
   * End notice early after resign accepted.
   * @param {{ profileId: string, reason: string, actor: import('mongoose').Document }} input
   */
  async releaseNoticeEarly({ profileId, reason, actor }) {
    const instituteId = resolveActorInstituteId(actor);
    const profile = await educatorHrService.releaseDuringNotice({
      actor,
      instituteId,
      profileId,
      reason,
    });
    const memberUser = await User.findById(profile.userId);
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    if (!memberUser) {
      throw new AppError('Educator not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }
    return toProfileTeamMember(profile, memberUser, owner);
  }
}

module.exports = {
  instituteTeamService: new InstituteTeamService(),
};
