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
  isLearnerRole,
} = require('../auth/auth.constants');
const {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
  INSTITUTE_STAFF_ROLES,
} = require('../educator-profile/educator-profile.model');
const {
  toProfileSummary,
  ensurePersonalLearnerProfile,
} = require('../educator-profile/educator-collab.service');
const { ensureInstituteCode } = require('../educator-profile/institute-code.util');
const {
  educatorHrService,
  syncProfileLifecycle,
  findOpenCollab,
  OPEN_COLLAB_STATUSES,
  ENTERABLE_COLLAB_STATUSES,
} = require('../educator-profile/educator-hr.service');
const { mailService } = require('../../common/mail/mail.service');
const { InstituteRole } = require('./institute-role.model');

const ALL_INSTITUTE_PERMISSION_CODES = new Set(
  Object.values(INSTITUTE_PERMISSIONS),
);
const ALL_EXAM_GOAL_CODES = new Set(EXAM_GOAL_CODES);

/**
 * Loads active institute membership onto the mongoose actor for permission checks.
 * Account role may stay `user` / `educator` while staff access lives on the profile.
 * @param {import('mongoose').Document} actor
 */
async function hydrateInstituteActorContext(actor) {
  if (!actor || actor.role === APP_ROLES.INSTITUTE) {
    return actor;
  }

  if (!actor.activeProfileId) {
    return actor;
  }

  const profile = await EducatorProfile.findOne({
    _id: actor.activeProfileId,
    userId: actor._id,
    type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
    status: { $in: [...ENTERABLE_COLLAB_STATUSES] },
  }).select('instituteId permissions staffRole customRoleId status');

  if (!profile?.instituteId) {
    return actor;
  }

  actor.instituteId = profile.instituteId;
  actor.permissions = Array.isArray(profile.permissions)
    ? [...profile.permissions]
    : [];
  actor._instituteStaffRole = profile.staffRole || '';
  actor._hydratedInstituteProfile = true;
  return actor;
}

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
 * Loads an active custom role owned by the institute.
 * @param {string} instituteId
 * @param {string|undefined|null} customRoleId
 */
async function loadInstituteCustomRole(instituteId, customRoleId) {
  const id = String(customRoleId || '').trim();
  if (!id) {
    return null;
  }

  const role = await InstituteRole.findOne({
    _id: id,
    instituteId,
    isDeleted: false,
  });
  if (!role) {
    throw new AppError('Custom role not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'CUSTOM_ROLE_NOT_FOUND',
    });
  }
  return role;
}

/**
 * Resolves permissions (+ optional customRoleId) for invite / hire / update.
 * @param {{
 *   role: string,
 *   permissions?: unknown,
 *   customRoleId?: string,
 *   actor: import('mongoose').Document,
 *   instituteId: string,
 * }} input
 */
async function resolveGrantBundle({
  role,
  permissions,
  customRoleId,
  actor,
  instituteId,
}) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || [];
  const canAssignRoles =
    actor.role === APP_ROLES.INSTITUTE ||
    resolveActorPermissions(actor).includes(
      INSTITUTE_PERMISSIONS.ROLES_ASSIGN,
    );

  // * Explicit custom template on hire/invite — apply whenever the template exists.
  const customRole = await loadInstituteCustomRole(instituteId, customRoleId);
  if (customRole) {
    if (!canAssignRoles) {
      throw new AppError(
        'You do not have permission to assign custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }
    const parsedPermissions = parsePermissionsField(permissions);
    return {
      permissions:
        parsedPermissions === undefined
          ? sanitizeInstitutePermissions(customRole.permissions)
          : parsedPermissions.length > 0
            ? parsedPermissions
            : sanitizeInstitutePermissions(customRole.permissions),
      customRoleId: customRole._id,
    };
  }

  if (!canAssignRoles) {
    return {
      permissions: [...defaults],
      customRoleId: null,
    };
  }

  const parsedPermissions = parsePermissionsField(permissions);
  return {
    permissions:
      parsedPermissions === undefined ? [...defaults] : parsedPermissions,
    customRoleId: null,
  };
}

/**
 * @param {import('mongoose').Document} roleDoc
 */
function toCustomRoleSummary(roleDoc) {
  const json = roleDoc.toJSON();
  return {
    id: json.id,
    name: json.name,
    description: json.description || '',
    permissions: Array.isArray(json.permissions) ? json.permissions : [],
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}

/**
 * @param {import('mongoose').Document} actor
 */
function assertCanManageCustomRoles(actor) {
  if (actor.role === APP_ROLES.INSTITUTE) {
    return;
  }
  const perms = resolveActorPermissions(actor);
  if (
    perms.includes(INSTITUTE_PERMISSIONS.ROLES_ASSIGN) ||
    perms.includes(INSTITUTE_PERMISSIONS.TEAM_MANAGE)
  ) {
    return;
  }
  throw new AppError(
    'You do not have permission to manage custom roles.',
    HTTP_STATUS.FORBIDDEN,
    { code: 'INSTITUTE_FORBIDDEN' },
  );
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

  if (actor.instituteId) {
    const allowedAccount =
      actor.role === APP_ROLES.INSTITUTE_ADMIN ||
      actor.role === APP_ROLES.EDUCATOR ||
      isLearnerRole(actor.role) ||
      Boolean(actor._hydratedInstituteProfile);

    if (allowedAccount) {
      return String(actor.instituteId);
    }
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
 * @param {{ customRoleName?: string }} [extras]
 */
function toTeamMember(member, extras = {}) {
  const user = toPublicUser(member);
  return {
    ...user,
    instituteId: user.instituteId,
    invitedByUserId: user.invitedByUserId,
    membershipKind: 'legacy',
    customRoleId: user.customRoleId,
    customRoleName: extras.customRoleName || undefined,
  };
}

/**
 * Profile-backed collab row for institute team directory.
 * @param {import('mongoose').Document} profile
 * @param {import('mongoose').Document} memberUser
 * @param {import('mongoose').Document | null} institute
 * @param {{ customRoleName?: string }} [extras]
 */
function toProfileTeamMember(profile, memberUser, institute, extras = {}) {
  const summary = toProfileSummary(profile, institute, {
    customRoleName: extras.customRoleName,
  });
  const user = toPublicUser(memberUser);
  const staffRole =
    summary.staffRole === INSTITUTE_STAFF_ROLES.INSTITUTE_ADMIN
      ? APP_ROLES.INSTITUTE_ADMIN
      : APP_ROLES.EDUCATOR;
  return {
    ...user,
    id: summary.id,
    userId: user.id,
    role: staffRole,
    accountStatus: summary.status,
    instituteId: summary.instituteId,
    permissions: summary.permissions,
    examGoals: summary.examGoals,
    profilePhotoPath: summary.profilePhotoPath || user.profilePhotoPath,
    invitedByUserId: summary.invitedByUserId,
    joinSource: summary.joinSource,
    membershipKind: 'profile',
    customRoleId: summary.customRoleId,
    customRoleName: summary.customRoleName || extras.customRoleName || undefined,
    createdAt: summary.createdAt,
    rejectionReason: summary.rejectionReason,
    reviewedAt: summary.reviewedAt,
    leaveReason: summary.leaveReason,
    leaveStartsAt: summary.leaveStartsAt,
    leaveEndsAt: summary.leaveEndsAt,
    leaveRequestedAt: summary.leaveRequestedAt,
    leaveRequests: summary.leaveRequests,
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
 * @param {Array<string|import('mongoose').Types.ObjectId|null|undefined>} ids
 * @returns {Promise<Map<string, string>>}
 */
async function loadCustomRoleNameMap(ids) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const unique = [
    ...new Set(
      (ids || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  ];
  if (unique.length === 0) {
    return map;
  }
  const roles = await InstituteRole.find({ _id: { $in: unique } }).select(
    'name',
  );
  for (const row of roles) {
    map.set(String(row._id), row.name);
  }
  return map;
}

/**
 * @param {import('mongoose').Document} profile
 * @param {import('mongoose').Document} memberUser
 * @param {import('mongoose').Document | null} institute
 */
async function toProfileTeamMemberResolved(profile, memberUser, institute) {
  let customRoleName;
  if (profile.customRoleId) {
    const map = await loadCustomRoleNameMap([profile.customRoleId]);
    customRoleName = map.get(String(profile.customRoleId));
  }
  return toProfileTeamMember(profile, memberUser, institute, {
    customRoleName,
  });
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
   * Lists custom roles for the actor's institute.
   * @param {{ actor: import('mongoose').Document }} input
   */
  async listCustomRoles({ actor }) {
    const instituteId = resolveActorInstituteId(actor);

    const canList =
      actor.role === APP_ROLES.INSTITUTE ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.TEAM_MANAGE,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.FACULTY_ADD,
      ) ||
      resolveActorPermissions(actor).includes(
        INSTITUTE_PERMISSIONS.ROLES_ASSIGN,
      );

    if (!canList) {
      throw new AppError(
        'You do not have permission to view custom roles.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const rows = await InstituteRole.find({
      instituteId,
      isDeleted: false,
    })
      .sort({ name: 1 })
      .limit(200);

    return rows.map(toCustomRoleSummary);
  }

  /**
   * Creates an institute-scoped custom role template.
   * @param {{
   *   actor: import('mongoose').Document,
   *   name: string,
   *   description?: string,
   *   permissions?: unknown,
   * }} input
   */
  async createCustomRole({
    actor,
    name,
    description,
    permissions,
  }) {
    const instituteId = resolveActorInstituteId(actor);
    assertCanManageCustomRoles(actor);

    const nextName = String(name || '').trim();
    if (!nextName || nextName.length < 2) {
      throw new AppError('Enter a role name.', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_ROLE_NAME',
      });
    }

    const nextPermissions = sanitizeInstitutePermissions(
      parsePermissionsField(permissions) || [],
    );
    if (nextPermissions.length === 0) {
      throw new AppError(
        'Select at least one permission for this role.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'PERMISSIONS_REQUIRED' },
      );
    }

    try {
      const role = await InstituteRole.create({
        instituteId,
        name: nextName,
        description: String(description || '').trim().slice(0, 300),
        baseRole: '',
        permissions: nextPermissions,
        createdByUserId: actor._id,
        isDeleted: false,
      });
      return toCustomRoleSummary(role);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'A custom role with this name already exists.',
          HTTP_STATUS.CONFLICT,
          { code: 'CUSTOM_ROLE_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * Updates an institute custom role template.
   * @param {{
   *   actor: import('mongoose').Document,
   *   roleId: string,
   *   name?: string,
   *   description?: string,
   *   permissions?: unknown,
   * }} input
   */
  async updateCustomRole({
    actor,
    roleId,
    name,
    description,
    permissions,
  }) {
    const instituteId = resolveActorInstituteId(actor);
    assertCanManageCustomRoles(actor);

    const role = await loadInstituteCustomRole(instituteId, roleId);

    if (name !== undefined) {
      const nextName = String(name || '').trim();
      if (!nextName || nextName.length < 2) {
        throw new AppError('Enter a role name.', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_ROLE_NAME',
        });
      }
      role.name = nextName;
    }

    if (description !== undefined) {
      role.description = String(description || '').trim().slice(0, 300);
    }

    if (permissions !== undefined) {
      const nextPermissions = sanitizeInstitutePermissions(
        parsePermissionsField(permissions) || [],
      );
      if (nextPermissions.length === 0) {
        throw new AppError(
          'Select at least one permission for this role.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'PERMISSIONS_REQUIRED' },
        );
      }
      role.permissions = nextPermissions;
    }

    // * Custom roles are permission packs only — clear legacy baseRole.
    role.baseRole = '';

    try {
      await role.save();
      return toCustomRoleSummary(role);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new AppError(
          'A custom role with this name already exists.',
          HTTP_STATUS.CONFLICT,
          { code: 'CUSTOM_ROLE_DUPLICATE' },
        );
      }
      throw error;
    }
  }

  /**
   * Soft-deletes a custom role. Staff keep their current permission snapshot.
   * @param {{ actor: import('mongoose').Document, roleId: string }} input
   */
  async deleteCustomRole({ actor, roleId }) {
    const instituteId = resolveActorInstituteId(actor);
    assertCanManageCustomRoles(actor);

    const role = await loadInstituteCustomRole(instituteId, roleId);
    role.isDeleted = true;
    await role.save();

    // * Detach template pointer; keep expanded permissions on members.
    await User.updateMany(
      { instituteId, customRoleId: role._id },
      { $set: { customRoleId: null } },
    );
    await EducatorProfile.updateMany(
      { instituteId, customRoleId: role._id },
      { $set: { customRoleId: null } },
    );

    return { id: String(role._id), deleted: true };
  }

  /**
   * @param {{ actor: import('mongoose').Document }} input
   */
  async listTeam({ actor }) {
    await hydrateInstituteActorContext(actor);
    const instituteId = resolveActorInstituteId(actor);

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

    const legacy = members.map((row) => toTeamMember(row));
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

    const customRoleNameMap = await loadCustomRoleNameMap([
      ...liveCollabs.map((row) => row.customRoleId),
      ...members.map((row) => row.customRoleId),
    ]);

    const legacyWithNames = members.map((row) =>
      toTeamMember(row, {
        customRoleName: row.customRoleId
          ? customRoleNameMap.get(String(row.customRoleId))
          : undefined,
      }),
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
      profileRows.push(
        toProfileTeamMember(profile, memberUser, owner, {
          customRoleName: profile.customRoleId
            ? customRoleNameMap.get(String(profile.customRoleId))
            : undefined,
        }),
      );
    }

    // * Declined hire invites — visible to institute with reason + timestamp.
    const declinedProfiles = await EducatorProfile.find({
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.REJECTED,
      joinSource: 'institute_hire',
    })
      .sort({ reviewedAt: -1, updatedAt: -1 })
      .limit(50);

    const declinedUserIds = [
      ...new Set(declinedProfiles.map((row) => String(row.userId))),
    ];
    const declinedUsers =
      declinedUserIds.length > 0
        ? await User.find({ _id: { $in: declinedUserIds } })
        : [];
    /** @type {Map<string, import('mongoose').Document>} */
    const declinedUserMap = new Map(
      declinedUsers.map((row) => [String(row._id), row]),
    );

    const declinedRoleMap = await loadCustomRoleNameMap(
      declinedProfiles.map((row) => row.customRoleId),
    );

    const declinedRows = [];
    for (const profile of declinedProfiles) {
      const memberUser = declinedUserMap.get(String(profile.userId));
      if (!memberUser) {
        continue;
      }
      declinedRows.push(
        toProfileTeamMember(profile, memberUser, owner, {
          customRoleName: profile.customRoleId
            ? declinedRoleMap.get(String(profile.customRoleId))
            : undefined,
        }),
      );
    }

    return [...profileRows, ...legacyWithNames, ...declinedRows];
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
    customRoleId,
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

    const grant = await resolveGrantBundle({
      role: nextRole,
      permissions,
      customRoleId,
      actor,
      instituteId,
    });
    const nextPermissions = grant.permissions;
    const nextCustomRoleId = grant.customRoleId;

    const existing = await User.findOne({ mobileNumber: normalizedMobile });
    if (existing) {
      return this.#inviteExistingFreelancer({
        existing,
        nextRole,
        name,
        normalizedEmail,
        nextExamGoals,
        nextPermissions,
        nextCustomRoleId,
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
        customRoleId: nextCustomRoleId,
        examGoals: nextExamGoals,
        profilePhotoPath: photoPath,
      });

      if (nextRole === APP_ROLES.EDUCATOR || nextRole === APP_ROLES.INSTITUTE_ADMIN) {
        await EducatorProfile.create({
          userId: member._id,
          type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
          instituteId,
          status: EDUCATOR_PROFILE_STATUSES.INVITED,
          permissions: nextPermissions,
          customRoleId: nextCustomRoleId,
          staffRole:
            nextRole === APP_ROLES.INSTITUTE_ADMIN
              ? INSTITUTE_STAFF_ROLES.INSTITUTE_ADMIN
              : INSTITUTE_STAFF_ROLES.EDUCATOR,
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
   * Hires an already-registered freelancer or learner without a second User.
   * Learners keep role `user`/`aspirant` and gain an institute membership profile.
   * @param {{
   *   existing: import('mongoose').Document,
   *   nextRole: string,
   *   name: string,
   *   normalizedEmail: string,
   *   nextExamGoals: string[],
   *   nextPermissions: string[],
   *   nextCustomRoleId?: import('mongoose').Types.ObjectId | null,
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
    nextCustomRoleId = null,
    profilePhotoPath,
    instituteId,
    owner,
    actor,
  }) {
    const isFreelancer =
      existing.role === APP_ROLES.EDUCATOR &&
      !existing.instituteId &&
      existing.accountStatus === ACCOUNT_STATUS.ACTIVE;

    const isLearner =
      isLearnerRole(existing.role) &&
      !existing.instituteId &&
      existing.accountStatus === ACCOUNT_STATUS.ACTIVE;

    if (isFreelancer) {
      if (nextRole !== APP_ROLES.EDUCATOR) {
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
    } else if (isLearner) {
      if (
        nextRole !== APP_ROLES.EDUCATOR &&
        nextRole !== APP_ROLES.INSTITUTE_ADMIN
      ) {
        throw new AppError(
          'This mobile number is already registered on BIGB.',
          HTTP_STATUS.CONFLICT,
          { code: 'MOBILE_ALREADY_REGISTERED' },
        );
      }
      await ensurePersonalLearnerProfile(existing);
    } else {
      throw new AppError(
        'This mobile number is already registered on BIGB.',
        HTTP_STATUS.CONFLICT,
        { code: 'MOBILE_ALREADY_REGISTERED' },
      );
    }

    const already = await findOpenCollab(existing._id, instituteId);
    if (already) {
      throw new AppError(
        already.status === EDUCATOR_PROFILE_STATUSES.ACTIVE
          ? 'This person already collaborates with your institute.'
          : 'An invite or collaboration already exists for this person.',
        HTTP_STATUS.CONFLICT,
        { code: 'COLLAB_EXISTS' },
      );
    }

    const photoPath =
      String(profilePhotoPath || '').trim() ||
      existing.profilePhotoPath ||
      '';

    let resolvedExamGoals = [...nextExamGoals];
    if (nextRole === APP_ROLES.EDUCATOR && resolvedExamGoals.length === 0) {
      if (existing.examGoal) {
        resolvedExamGoals = [String(existing.examGoal)];
      } else if (Array.isArray(existing.examGoals) && existing.examGoals.length) {
        resolvedExamGoals = [...existing.examGoals];
      }
    }

    if (nextRole === APP_ROLES.EDUCATOR && resolvedExamGoals.length === 0) {
      throw new AppError(
        'Select at least one exam this educator prepares students for.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EXAM_GOALS_REQUIRED' },
      );
    }

    const profile = await EducatorProfile.create({
      userId: existing._id,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: EDUCATOR_PROFILE_STATUSES.INVITED,
      permissions: nextPermissions,
      customRoleId: nextCustomRoleId || null,
      staffRole:
        nextRole === APP_ROLES.INSTITUTE_ADMIN
          ? INSTITUTE_STAFF_ROLES.INSTITUTE_ADMIN
          : INSTITUTE_STAFF_ROLES.EDUCATOR,
      displayName: name || existing.fullName || '',
      examGoals: resolvedExamGoals,
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

    return toProfileTeamMemberResolved(profile, existing, owner);
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

    return toProfileTeamMemberResolved(profile, memberUser, owner);
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
   * Search hireable people: approved freelancer educators + active learners.
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
        'You do not have permission to hire team members.',
        HTTP_STATUS.FORBIDDEN,
        { code: 'INSTITUTE_FORBIDDEN' },
      );
    }

    const query = String(q || '').trim();
    /** @type {Record<string, unknown>} */
    const userFilter = {
      role: { $in: [APP_ROLES.EDUCATOR, APP_ROLES.USER, APP_ROLES.ASPIRANT] },
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
        'fullName email mobileNumber role examGoal examGoals profilePhotoPath verificationLevel',
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

    const approvedEducatorIds = new Set(
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
      .filter((row) => {
        if (isLearnerRole(row.role)) {
          return true;
        }
        return approvedEducatorIds.has(String(row._id));
      })
      .map((row) => {
        const id = String(row._id);
        const examGoals = Array.isArray(row.examGoals) ? [...row.examGoals] : [];
        if (row.examGoal && !examGoals.includes(row.examGoal)) {
          examGoals.unshift(row.examGoal);
        }
        return {
          id,
          fullName: row.fullName || '',
          email: row.email || '',
          mobileNumber: row.mobileNumber || '',
          role: isLearnerRole(row.role) ? APP_ROLES.USER : APP_ROLES.EDUCATOR,
          examGoals,
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
    customRoleId,
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
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    const grant = await resolveGrantBundle({
      role: APP_ROLES.EDUCATOR,
      permissions,
      customRoleId,
      actor,
      instituteId,
    });

    const nextExamGoals = sanitizeExamGoals(
      examGoals !== undefined ? examGoals : existing.examGoals,
    );
    let resolvedExamGoals =
      nextExamGoals.length > 0
        ? nextExamGoals
        : Array.isArray(existing.examGoals)
          ? [...existing.examGoals]
          : [];
    if (resolvedExamGoals.length === 0 && existing.examGoal) {
      resolvedExamGoals = [String(existing.examGoal)];
    }

    if (resolvedExamGoals.length === 0 && !isLearnerRole(existing.role)) {
      throw new AppError(
        'This educator has no exam goals on file. Ask them to update their profile, or hire via full invite form.',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'EXAM_GOALS_REQUIRED' },
      );
    }

    return this.#inviteExistingFreelancer({
      existing,
      nextRole: APP_ROLES.EDUCATOR,
      name: existing.fullName || 'Member',
      normalizedEmail: existing.email,
      nextExamGoals: resolvedExamGoals,
      nextPermissions: grant.permissions,
      nextCustomRoleId: grant.customRoleId,
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
    customRoleId,
    examGoals,
    profilePhotoPath,
    accountStatus,
    actor,
  }) {
    const instituteId = resolveActorInstituteId(actor);

    // * Profile-backed hire rows use EducatorProfile id; legacy rows use User id.
    const profileMember = await EducatorProfile.findOne({
      _id: memberId,
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId,
      status: { $in: [...OPEN_COLLAB_STATUSES] },
    });

    if (profileMember) {
      return this.#updateProfileMember({
        profile: profileMember,
        instituteId,
        fullName,
        permissions,
        customRoleId,
        examGoals,
        profilePhotoPath,
        actor,
      });
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

    if (permissions !== undefined || customRoleId !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.ROLES_ASSIGN);
      const grant = await resolveGrantBundle({
        role: member.role,
        permissions:
          permissions !== undefined ? permissions : member.permissions,
        customRoleId:
          customRoleId !== undefined
            ? customRoleId || null
            : member.customRoleId
              ? String(member.customRoleId)
              : undefined,
        actor,
        instituteId,
      });
      // * Empty string clears the custom template while keeping permissions.
      if (customRoleId === '' || customRoleId === null) {
        member.customRoleId = null;
        if (permissions !== undefined) {
          member.permissions = parsePermissionsField(permissions) || [];
        }
      } else {
        member.permissions = grant.permissions;
        member.customRoleId = grant.customRoleId;
      }
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

    // * Keep mirrored institute educator profile grants in sync.
    if (member.role === APP_ROLES.EDUCATOR) {
      await EducatorProfile.updateOne(
        {
          userId: member._id,
          type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
          instituteId,
          status: { $in: [...OPEN_COLLAB_STATUSES] },
        },
        {
          $set: {
            permissions: member.permissions,
            customRoleId: member.customRoleId,
            ...(examGoals !== undefined ? { examGoals: member.examGoals } : {}),
            ...(fullName !== undefined ? { displayName: member.fullName } : {}),
            ...(profilePhotoPath !== undefined
              ? { profilePhotoPath: member.profilePhotoPath }
              : {}),
          },
        },
      );
    }

    return toTeamMember(member);
  }

  /**
   * Updates permissions / details on a profile-backed team row.
   * @param {{
   *   profile: import('mongoose').Document,
   *   instituteId: string,
   *   fullName?: string,
   *   permissions?: unknown,
   *   customRoleId?: string | null,
   *   examGoals?: unknown,
   *   profilePhotoPath?: string,
   *   actor: import('mongoose').Document,
   * }} input
   */
  async #updateProfileMember({
    profile,
    instituteId,
    fullName,
    permissions,
    customRoleId,
    examGoals,
    profilePhotoPath,
    actor,
  }) {
    const memberUser = await User.findById(profile.userId);
    if (!memberUser) {
      throw new AppError('Team member not found.', HTTP_STATUS.NOT_FOUND, {
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    if (String(memberUser._id) === String(actor._id)) {
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
      profile.displayName = name;
    }

    if (permissions !== undefined || customRoleId !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.ROLES_ASSIGN);
      if (customRoleId === '' || customRoleId === null) {
        profile.customRoleId = null;
        if (permissions !== undefined) {
          profile.permissions = parsePermissionsField(permissions) || [];
        }
      } else {
        const grant = await resolveGrantBundle({
          role: APP_ROLES.EDUCATOR,
          permissions:
            permissions !== undefined ? permissions : profile.permissions,
          customRoleId:
            customRoleId !== undefined
              ? customRoleId
              : profile.customRoleId
                ? String(profile.customRoleId)
                : undefined,
          actor,
          instituteId,
        });
        profile.permissions = grant.permissions;
        profile.customRoleId = grant.customRoleId;
      }
    }

    if (examGoals !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      const nextExamGoals = sanitizeExamGoals(examGoals);
      if (nextExamGoals.length === 0) {
        throw new AppError(
          'Select at least one exam this educator prepares students for.',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'EXAM_GOALS_REQUIRED' },
        );
      }
      profile.examGoals = nextExamGoals;
    }

    if (profilePhotoPath !== undefined) {
      assertActorHasPermission(actor, INSTITUTE_PERMISSIONS.TEAM_MANAGE);
      profile.profilePhotoPath = String(profilePhotoPath || '').trim();
    }

    await profile.save();
    const owner = await User.findById(instituteId).select(
      'instituteName fullName instituteLogoPath instituteCode',
    );
    return toProfileTeamMemberResolved(profile, memberUser, owner);
  }

  /**
   * Soft-delete — removes from team and blocks OTP login.
   *
   * @param {{ memberId: string, actor: import('mongoose').Document }} input
   */
  async removeMember({ memberId, actor }) {
    const instituteId = resolveActorInstituteId(actor);

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
  async decideLeaveRequest({
    profileId,
    decision,
    note,
    actor,
    leaveRequestId,
  }) {
    const instituteId = resolveActorInstituteId(actor);
    const profile = await educatorHrService.decideLeave({
      actor,
      instituteId,
      profileId,
      decision,
      note,
      leaveRequestId,
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
    return toProfileTeamMemberResolved(profile, memberUser, owner);
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
    return toProfileTeamMemberResolved(profile, memberUser, owner);
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
    return toProfileTeamMemberResolved(profile, memberUser, owner);
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
    return toProfileTeamMemberResolved(profile, memberUser, owner);
  }
}

module.exports = {
  instituteTeamService: new InstituteTeamService(),
  hydrateInstituteActorContext,
};
