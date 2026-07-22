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

    return members.map(toTeamMember);
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
      throw new AppError(
        'This mobile number is already registered on BIGB.',
        HTTP_STATUS.CONFLICT,
        { code: 'MOBILE_ALREADY_REGISTERED' },
      );
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
}

module.exports = {
  instituteTeamService: new InstituteTeamService(),
};
