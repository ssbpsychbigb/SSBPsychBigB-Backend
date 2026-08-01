'use strict';

/**
 * Shared auth domain constants for app + admin portals.
 */

const APP_ROLES = Object.freeze({
  /** Primary learner / consumer identity (replaces Student product language). */
  USER: 'user',
  /** @deprecated Legacy learner role — still readable; new registers use `user`. */
  ASPIRANT: 'aspirant',
  INSTITUTE: 'institute',
  INSTITUTE_ADMIN: 'institute_admin',
  EDUCATOR: 'educator',
  DEFENCE_OFFICER: 'defence_officer',
});

/** Learner account roles (learn profile + optional institute staff profiles). */
const LEARNER_ROLES = Object.freeze([APP_ROLES.USER, APP_ROLES.ASPIRANT]);

/**
 * @param {string | undefined | null} role
 * @returns {boolean}
 */
function isLearnerRole(role) {
  return LEARNER_ROLES.includes(String(role || ''));
}

const ADMIN_ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  PLATFORM_ADMIN: 'platform_admin',
  PLATFORM_MODERATOR: 'platform_moderator',
});

/** Roles Super Admin may assign when creating staff (never another Super Admin). */
const ASSIGNABLE_ADMIN_ROLES = Object.freeze([
  ADMIN_ROLES.PLATFORM_ADMIN,
  ADMIN_ROLES.PLATFORM_MODERATOR,
]);

/** Roles an institute owner/admin may invite (app portal, OTP login). */
const ASSIGNABLE_INSTITUTE_ROLES = Object.freeze([
  APP_ROLES.INSTITUTE_ADMIN,
  APP_ROLES.EDUCATOR,
]);

const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING_VERIFICATION: 'pending_verification',
  REJECTED: 'rejected',
  INVITED: 'invited',
  RESTRICTED: 'restricted',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  DELETED: 'deleted',
});

const OTP_PURPOSE = Object.freeze({
  REGISTER: 'register',
  LOGIN: 'login',
});

const PORTAL = Object.freeze({
  APP: 'app',
  ADMIN: 'admin',
});

const JOIN_TYPE_TO_ROLE = Object.freeze({
  /** Preferred public register join type. */
  user: APP_ROLES.USER,
  /** Legacy alias — still accepted from older clients. */
  aspirant: APP_ROLES.USER,
  institute: APP_ROLES.INSTITUTE,
  defence_officer: APP_ROLES.DEFENCE_OFFICER,
  /** Public Freelancer Educator apply path (not institute invite). */
  educator: APP_ROLES.EDUCATOR,
});

/** Roles that stay locked until platform admin approval. */
const PENDING_ON_REGISTER_ROLES = new Set([
  APP_ROLES.INSTITUTE,
  APP_ROLES.DEFENCE_OFFICER,
  APP_ROLES.EDUCATOR,
]);

/**
 * Stable admin permission codes — data-driven baseline (SRS Ch6 + product).
 * Super Admin may add/remove these when creating or editing staff.
 */
const ADMIN_PERMISSIONS = Object.freeze({
  INSTITUTE_VERIFY: 'admin.institute_verify',
  OFFICER_VERIFY: 'admin.officer_verify',
  EDUCATOR_VERIFY: 'admin.educator_verify',
  USERS_READ: 'admin.users.read',
  USERS_MANAGE: 'admin.users.manage',
  STAFF_MANAGE: 'admin.staff.manage',
  MODERATION: 'admin.moderation',
  NOTIFICATIONS_MANAGE: 'admin.notifications.manage',
});

/** Human labels for permission catalog API / admin UI. */
const ADMIN_PERMISSION_META = Object.freeze({
  [ADMIN_PERMISSIONS.INSTITUTE_VERIFY]: {
    label: 'Institute verification',
    description: 'Approve or reject coaching institute applications.',
    group: 'Verification',
  },
  [ADMIN_PERMISSIONS.OFFICER_VERIFY]: {
    label: 'Officer verification',
    description: 'Approve or reject defence officer applications.',
    group: 'Verification',
  },
  [ADMIN_PERMISSIONS.EDUCATOR_VERIFY]: {
    label: 'Educator verification',
    description: 'Approve or reject freelancer educator applications.',
    group: 'Verification',
  },
  [ADMIN_PERMISSIONS.USERS_READ]: {
    label: 'View users',
    description: 'Browse the app-user directory.',
    group: 'Users',
  },
  [ADMIN_PERMISSIONS.USERS_MANAGE]: {
    label: 'Manage users',
    description: 'Suspend, ban, reactivate, or soft-delete app users.',
    group: 'Users',
  },
  [ADMIN_PERMISSIONS.STAFF_MANAGE]: {
    label: 'Manage admin staff',
    description: 'Create and manage Platform Admins and Moderators.',
    group: 'Staff',
  },
  [ADMIN_PERMISSIONS.MODERATION]: {
    label: 'Content moderation',
    description: 'Hide posts, review reports, warn users (feed tools).',
    group: 'Moderation',
  },
  [ADMIN_PERMISSIONS.NOTIFICATIONS_MANAGE]: {
    label: 'Notifications',
    description: 'Broadcast platform notifications.',
    group: 'Platform',
  },
});

/**
 * Institute-scoped permission codes (SRS §6.4–6.5 + §7.4–7.10).
 * Defaults apply on invite; institute owner/admin may add or remove within this catalog.
 * Changes stay on the member user and only apply inside their instituteId.
 */
const INSTITUTE_PERMISSIONS = Object.freeze({
  PROFILE_MANAGE: 'institute.profile_manage',
  FACULTY_ADD: 'institute.faculty_add',
  FACULTY_REMOVE: 'institute.faculty_remove',
  TEAM_MANAGE: 'institute.team_manage',
  STUDENTS_MANAGE: 'institute.students_manage',
  BATCHES_MANAGE: 'institute.batches_manage',
  EVENTS_PUBLISH: 'institute.events_publish',
  ANALYTICS_VIEW: 'institute.analytics_view',
  ADMISSIONS_MANAGE: 'institute.admissions_manage',
  CERTIFICATES_MANAGE: 'institute.certificates_manage',
  ROLES_ASSIGN: 'institute.roles_assign',
  REPORTS_EXPORT: 'institute.reports_export',
  COURSE_CREATE: 'course.create',
  COURSE_PUBLISH: 'course.publish',
  COURSE_EDIT: 'course.edit',
  COURSE_DELETE: 'course.delete',
  ASSESSMENT_CREATE: 'assessment.create',
  ASSESSMENT_PUBLISH: 'assessment.publish',
  ASSESSMENT_GRADE: 'assessment.grade',
  LIVE_SCHEDULE: 'live.schedule',
  LIVE_START: 'live.start',
  LIVE_END: 'live.end',
  COMMUNITY_CREATE: 'community.create',
  COMMUNITY_MODERATE: 'community.moderate',
  REVENUE_VIEW: 'commerce.revenue_institute',
});

const INSTITUTE_PERMISSION_META = Object.freeze({
  [INSTITUTE_PERMISSIONS.PROFILE_MANAGE]: {
    label: 'Institute profile',
    description: 'Edit institute profile, branding, and public details.',
    group: 'Institute',
  },
  [INSTITUTE_PERMISSIONS.FACULTY_ADD]: {
    label: 'Add educators',
    description: 'Invite Verified Educators to this institute.',
    group: 'Team',
  },
  [INSTITUTE_PERMISSIONS.FACULTY_REMOVE]: {
    label: 'Remove educators',
    description: 'Suspend or remove educators from this institute.',
    group: 'Team',
  },
  [INSTITUTE_PERMISSIONS.TEAM_MANAGE]: {
    label: 'Manage team',
    description: 'Invite and manage Institute Admins and Educators.',
    group: 'Team',
  },
  [INSTITUTE_PERMISSIONS.ROLES_ASSIGN]: {
    label: 'Assign permissions',
    description: 'Add or remove permissions for institute team members.',
    group: 'Team',
  },
  [INSTITUTE_PERMISSIONS.STUDENTS_MANAGE]: {
    label: 'Manage students',
    description: 'View and manage students linked to this institute.',
    group: 'Students',
  },
  [INSTITUTE_PERMISSIONS.BATCHES_MANAGE]: {
    label: 'Manage batches',
    description: 'Create and manage learning batches.',
    group: 'Students',
  },
  [INSTITUTE_PERMISSIONS.ADMISSIONS_MANAGE]: {
    label: 'Admissions',
    description: 'Manage institute admissions workflows.',
    group: 'Students',
  },
  [INSTITUTE_PERMISSIONS.CERTIFICATES_MANAGE]: {
    label: 'Certificates',
    description: 'Issue and manage student certificates.',
    group: 'Students',
  },
  [INSTITUTE_PERMISSIONS.EVENTS_PUBLISH]: {
    label: 'Publish events',
    description: 'Publish institute events and sessions.',
    group: 'Content',
  },
  [INSTITUTE_PERMISSIONS.ANALYTICS_VIEW]: {
    label: 'Analytics',
    description: 'View institute analytics dashboards.',
    group: 'Reports',
  },
  [INSTITUTE_PERMISSIONS.REPORTS_EXPORT]: {
    label: 'Export reports',
    description: 'Export institute reports and CSV data.',
    group: 'Reports',
  },
  [INSTITUTE_PERMISSIONS.REVENUE_VIEW]: {
    label: 'View revenue',
    description: 'View institute-attributed revenue.',
    group: 'Reports',
  },
  [INSTITUTE_PERMISSIONS.COURSE_CREATE]: {
    label: 'Create courses',
    description: 'Create institute-branded or educator courses.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.COURSE_PUBLISH]: {
    label: 'Publish courses',
    description: 'Publish courses to the catalogue.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.COURSE_EDIT]: {
    label: 'Edit courses',
    description: 'Edit course content and lessons.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.COURSE_DELETE]: {
    label: 'Delete courses',
    description: 'Delete or archive institute courses.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.ASSESSMENT_CREATE]: {
    label: 'Create assessments',
    description: 'Create tests and practice assessments.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.ASSESSMENT_PUBLISH]: {
    label: 'Publish assessments',
    description: 'Publish assessments for students.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.ASSESSMENT_GRADE]: {
    label: 'Grade assessments',
    description: 'Grade student assessment submissions.',
    group: 'Learning',
  },
  [INSTITUTE_PERMISSIONS.LIVE_SCHEDULE]: {
    label: 'Schedule live sessions',
    description: 'Schedule live teaching sessions.',
    group: 'Live',
  },
  [INSTITUTE_PERMISSIONS.LIVE_START]: {
    label: 'Start live sessions',
    description: 'Start scheduled live sessions.',
    group: 'Live',
  },
  [INSTITUTE_PERMISSIONS.LIVE_END]: {
    label: 'End live sessions',
    description: 'End active live sessions.',
    group: 'Live',
  },
  [INSTITUTE_PERMISSIONS.COMMUNITY_CREATE]: {
    label: 'Create communities',
    description: 'Create learning communities for students.',
    group: 'Community',
  },
  [INSTITUTE_PERMISSIONS.COMMUNITY_MODERATE]: {
    label: 'Moderate communities',
    description: 'Moderate institute learning communities.',
    group: 'Community',
  },
});

const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ADMIN_ROLES.SUPER_ADMIN]: Object.values(ADMIN_PERMISSIONS),
  [ADMIN_ROLES.PLATFORM_ADMIN]: [
    ADMIN_PERMISSIONS.INSTITUTE_VERIFY,
    ADMIN_PERMISSIONS.OFFICER_VERIFY,
    ADMIN_PERMISSIONS.EDUCATOR_VERIFY,
    ADMIN_PERMISSIONS.USERS_READ,
    ADMIN_PERMISSIONS.USERS_MANAGE,
    ADMIN_PERMISSIONS.NOTIFICATIONS_MANAGE,
  ],
  [ADMIN_ROLES.PLATFORM_MODERATOR]: [
    ADMIN_PERMISSIONS.USERS_READ,
    ADMIN_PERMISSIONS.MODERATION,
  ],
  /** Owner has full institute catalog implicitly in services; stored for clarity. */
  [APP_ROLES.INSTITUTE]: Object.values(INSTITUTE_PERMISSIONS),
  [APP_ROLES.INSTITUTE_ADMIN]: [
    INSTITUTE_PERMISSIONS.PROFILE_MANAGE,
    INSTITUTE_PERMISSIONS.FACULTY_ADD,
    INSTITUTE_PERMISSIONS.FACULTY_REMOVE,
    INSTITUTE_PERMISSIONS.TEAM_MANAGE,
    INSTITUTE_PERMISSIONS.ROLES_ASSIGN,
    INSTITUTE_PERMISSIONS.STUDENTS_MANAGE,
    INSTITUTE_PERMISSIONS.CERTIFICATES_MANAGE,
    INSTITUTE_PERMISSIONS.ANALYTICS_VIEW,
    INSTITUTE_PERMISSIONS.REPORTS_EXPORT,
    INSTITUTE_PERMISSIONS.REVENUE_VIEW,
    INSTITUTE_PERMISSIONS.COURSE_CREATE,
    INSTITUTE_PERMISSIONS.COURSE_PUBLISH,
    INSTITUTE_PERMISSIONS.COURSE_EDIT,
    INSTITUTE_PERMISSIONS.COURSE_DELETE,
    INSTITUTE_PERMISSIONS.EVENTS_PUBLISH,
  ],
  /** Institute Educator (Limited Rights) — invite path only. */
  [APP_ROLES.EDUCATOR]: [
    INSTITUTE_PERMISSIONS.COURSE_CREATE,
    INSTITUTE_PERMISSIONS.COURSE_PUBLISH,
    INSTITUTE_PERMISSIONS.COURSE_EDIT,
    INSTITUTE_PERMISSIONS.ASSESSMENT_CREATE,
    INSTITUTE_PERMISSIONS.ASSESSMENT_PUBLISH,
    INSTITUTE_PERMISSIONS.ASSESSMENT_GRADE,
    INSTITUTE_PERMISSIONS.LIVE_SCHEDULE,
    INSTITUTE_PERMISSIONS.LIVE_START,
    INSTITUTE_PERMISSIONS.LIVE_END,
    INSTITUTE_PERMISSIONS.COMMUNITY_CREATE,
  ],
});

/**
 * Freelancer Educator Master Rights (personal brand).
 * Reuses shared learning codes where meaning matches institute catalog.
 */
const FREELANCER_PERMISSIONS = Object.freeze({
  PROFILE_MANAGE: 'educator.profile_manage',
  COURSE_CREATE: INSTITUTE_PERMISSIONS.COURSE_CREATE,
  COURSE_EDIT: INSTITUTE_PERMISSIONS.COURSE_EDIT,
  COURSE_DELETE: INSTITUTE_PERMISSIONS.COURSE_DELETE,
  COURSE_PUBLISH: INSTITUTE_PERMISSIONS.COURSE_PUBLISH,
  COURSE_SELL: 'course.sell',
  PRICING_MANAGE: 'commerce.pricing_manage',
  DISCOUNT_MANAGE: 'commerce.discount_manage',
  ASSESSMENT_CREATE: INSTITUTE_PERMISSIONS.ASSESSMENT_CREATE,
  ASSESSMENT_PUBLISH: INSTITUTE_PERMISSIONS.ASSESSMENT_PUBLISH,
  LIVE_SCHEDULE: INSTITUTE_PERMISSIONS.LIVE_SCHEDULE,
  LIVE_START: INSTITUTE_PERMISSIONS.LIVE_START,
  LIVE_END: INSTITUTE_PERMISSIONS.LIVE_END,
  MATERIAL_UPLOAD: 'material.upload',
  STUDENTS_MANAGE: 'students.manage',
  ANALYTICS_VIEW: 'analytics.view',
  CERTIFICATES_MANAGE: 'certificates.manage',
});

const FREELANCER_MASTER_PERMISSIONS = Object.freeze(
  Object.values(FREELANCER_PERMISSIONS),
);

const VERIFICATION_LEVEL_ON_APPROVE = Object.freeze({
  [APP_ROLES.INSTITUTE]: 4,
  [APP_ROLES.DEFENCE_OFFICER]: 3,
  /** Verified Educator (freelancer approve). */
  [APP_ROLES.EDUCATOR]: 2,
});

/** Verification level applied when an invited educator activates via OTP. */
const VERIFICATION_LEVEL_ON_INVITE_ACTIVATE = Object.freeze({
  [APP_ROLES.EDUCATOR]: 2,
  [APP_ROLES.INSTITUTE_ADMIN]: 1,
});

/** Allowed exam/prep codes for educator multi-select. */
const EXAM_GOAL_CODES = Object.freeze([
  'nda',
  'cds',
  'afcat',
  'ssb',
  'capf',
  'agniveer',
  'inet',
  'other',
]);

/**
 * Rejectable application fields by role (shared with admin reject + applicant resubmit).
 * Keep codes stable — they are stored on User.rejectedFields.
 */
const REJECTION_FIELDS_BY_ROLE = Object.freeze({
  [APP_ROLES.INSTITUTE]: Object.freeze([
    'email',
    'mobileNumber',
    'instituteName',
    'instituteLogo',
  ]),
  [APP_ROLES.DEFENCE_OFFICER]: Object.freeze([
    'fullName',
    'email',
    'mobileNumber',
    'officerPhoto',
    'officerIdDocument',
  ]),
  [APP_ROLES.EDUCATOR]: Object.freeze([
    'fullName',
    'email',
    'mobileNumber',
    'examGoals',
    'profilePhoto',
    'idDocument',
  ]),
});

const REJECTION_FIELD_LABELS = Object.freeze({
  fullName: 'Full name',
  email: 'Email',
  mobileNumber: 'Mobile number',
  instituteName: 'Institute name',
  instituteLogo: 'Institute logo',
  officerPhoto: 'Officer photo',
  officerIdDocument: 'ID document',
  examGoals: 'Exam / prep goals',
  profilePhoto: 'Profile photo',
  idDocument: 'ID document',
});

module.exports = {
  APP_ROLES,
  LEARNER_ROLES,
  isLearnerRole,
  ADMIN_ROLES,
  ASSIGNABLE_ADMIN_ROLES,
  ASSIGNABLE_INSTITUTE_ROLES,
  ACCOUNT_STATUS,
  OTP_PURPOSE,
  PORTAL,
  JOIN_TYPE_TO_ROLE,
  PENDING_ON_REGISTER_ROLES,
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_META,
  INSTITUTE_PERMISSIONS,
  INSTITUTE_PERMISSION_META,
  ROLE_DEFAULT_PERMISSIONS,
  FREELANCER_PERMISSIONS,
  FREELANCER_MASTER_PERMISSIONS,
  VERIFICATION_LEVEL_ON_APPROVE,
  VERIFICATION_LEVEL_ON_INVITE_ACTIVATE,
  EXAM_GOAL_CODES,
  REJECTION_FIELDS_BY_ROLE,
  REJECTION_FIELD_LABELS,
};
