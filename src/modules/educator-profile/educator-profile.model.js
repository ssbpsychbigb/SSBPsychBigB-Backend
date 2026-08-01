'use strict';

const mongoose = require('mongoose');
const { ACCOUNT_STATUS } = require('../auth/auth.constants');
const { OPEN_COLLAB_STATUSES } = require('./educator-hr.constants');

/**
 * One brand/context per document.
 * Freelancer = personal educator brand; personal = learner home profile;
 * institute = staff membership under one institute.
 */
const EDUCATOR_PROFILE_TYPES = Object.freeze({
  FREELANCER: 'freelancer',
  PERSONAL: 'personal',
  INSTITUTE: 'institute',
});

/** Staff role carried on an institute membership profile (permissions still authoritative). */
const INSTITUTE_STAFF_ROLES = Object.freeze({
  EDUCATOR: 'educator',
  INSTITUTE_ADMIN: 'institute_admin',
});

const EDUCATOR_PROFILE_STATUSES = Object.freeze({
  INVITED: ACCOUNT_STATUS.INVITED,
  PENDING_VERIFICATION: ACCOUNT_STATUS.PENDING_VERIFICATION,
  ACTIVE: ACCOUNT_STATUS.ACTIVE,
  REJECTED: ACCOUNT_STATUS.REJECTED,
  SUSPENDED: ACCOUNT_STATUS.SUSPENDED,
  DELETED: ACCOUNT_STATUS.DELETED,
  /** Temporary leave requested — waiting institute decision. */
  LEAVE_PENDING: 'leave_pending',
  /** Approved temporary leave (still a member). */
  ON_LEAVE: 'on_leave',
  /** Permanent resign requested — waiting institute decision. */
  RESIGN_PENDING: 'resign_pending',
  /** Resign accepted — serving notice (default 14 days). */
  NOTICE_PERIOD: 'notice_period',
  /** Collaboration finished — re-hire allowed. */
  ENDED: 'ended',
});

const EXIT_ENDED_BY = Object.freeze({
  EDUCATOR_RESIGN: 'educator_resign',
  INSTITUTE_FIRE: 'institute_fire',
  INSTITUTE_ACCEPTED_RESIGN: 'institute_accepted_resign',
  SYSTEM_NOTICE_COMPLETE: 'system_notice_complete',
});

const educatorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(EDUCATOR_PROFILE_TYPES),
      required: true,
    },
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(EDUCATOR_PROFILE_STATUSES),
      required: true,
      default: EDUCATOR_PROFILE_STATUSES.PENDING_VERIFICATION,
    },
    permissions: {
      type: [String],
      default: [],
    },
    /**
     * Account-type intent for institute membership (Admin vs Educator).
     * Permissions remain the access source of truth.
     */
    staffRole: {
      type: String,
      enum: [...Object.values(INSTITUTE_STAFF_ROLES), ''],
      default: '',
    },
    /** Optional institute custom role template for this membership. */
    customRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstituteRole',
      default: null,
    },
    displayName: {
      type: String,
      trim: true,
      default: '',
    },
    headline: {
      type: String,
      trim: true,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      default: '',
    },
    examGoals: {
      type: [String],
      default: [],
    },
    profilePhotoPath: {
      type: String,
      default: '',
    },
    idDocumentPath: {
      type: String,
      default: '',
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
    rejectedFields: {
      type: [String],
      default: [],
    },
    previousRejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
    previousRejectedFields: {
      type: [String],
      default: [],
    },
    resubmittedAt: {
      type: Date,
      default: null,
    },
    resubmissionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /**
     * How this institute membership was created.
     * institute_hire — institute invited freelancer
     * educator_request — freelancer requested via institute code
     * legacy_invite — classic new-user faculty invite
     */
    joinSource: {
      type: String,
      enum: ['institute_hire', 'educator_request', 'legacy_invite', ''],
      default: '',
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    /** Status before leave/resign request — used on cancel/reject restore. */
    previousStatus: {
      type: String,
      default: '',
      trim: true,
    },
    leaveReason: {
      type: String,
      default: '',
      trim: true,
    },
    leaveStartsAt: {
      type: Date,
      default: null,
    },
    leaveEndsAt: {
      type: Date,
      default: null,
    },
    leaveRequestedAt: {
      type: Date,
      default: null,
    },
    leaveDecidedAt: {
      type: Date,
      default: null,
    },
    leaveDecisionNote: {
      type: String,
      default: '',
      trim: true,
    },
    /**
     * Independent leave requests (pending / approved / …).
     * Multiple fresh requests are allowed; update only while pending.
     */
    leaveRequests: {
      type: [
        {
          reason: { type: String, default: '', trim: true },
          startsAt: { type: Date, required: true },
          endsAt: { type: Date, required: true },
          requestedAt: { type: Date, default: Date.now },
          decidedAt: { type: Date, default: null },
          decisionNote: { type: String, default: '', trim: true },
          status: {
            type: String,
            enum: [
              'pending',
              'approved',
              'rejected',
              'cancelled',
              'completed',
            ],
            default: 'pending',
          },
        },
      ],
      default: [],
    },
    resignReason: {
      type: String,
      default: '',
      trim: true,
    },
    resignRequestedAt: {
      type: Date,
      default: null,
    },
    resignDecidedAt: {
      type: Date,
      default: null,
    },
    resignDecisionNote: {
      type: String,
      default: '',
      trim: true,
    },
    noticeStartedAt: {
      type: Date,
      default: null,
    },
    noticeEndsAt: {
      type: Date,
      default: null,
    },
    noticeDays: {
      type: Number,
      default: null,
    },
    exitReason: {
      type: String,
      default: '',
      trim: true,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    endedBy: {
      type: String,
      enum: [...Object.values(EXIT_ENDED_BY), ''],
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

educatorProfileSchema.index({ userId: 1, type: 1 });
educatorProfileSchema.index({ type: 1, status: 1, createdAt: 1 });

// * One active/pending freelancer brand per user (soft-deleted rows excluded).
educatorProfileSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: EDUCATOR_PROFILE_TYPES.FREELANCER,
      status: {
        $in: [
          EDUCATOR_PROFILE_STATUSES.PENDING_VERIFICATION,
          EDUCATOR_PROFILE_STATUSES.ACTIVE,
          EDUCATOR_PROFILE_STATUSES.REJECTED,
          EDUCATOR_PROFILE_STATUSES.SUSPENDED,
          EDUCATOR_PROFILE_STATUSES.INVITED,
        ],
      },
    },
  },
);

// * One open membership per institute per user (ended/deleted allow re-hire).
educatorProfileSchema.index(
  { userId: 1, instituteId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: EDUCATOR_PROFILE_TYPES.INSTITUTE,
      instituteId: { $type: 'objectId' },
      status: { $in: [...OPEN_COLLAB_STATUSES] },
    },
  },
);

const EducatorProfile = mongoose.model('EducatorProfile', educatorProfileSchema);

module.exports = {
  EducatorProfile,
  EDUCATOR_PROFILE_TYPES,
  EDUCATOR_PROFILE_STATUSES,
  INSTITUTE_STAFF_ROLES,
  EXIT_ENDED_BY,
};
