'use strict';

const mongoose = require('mongoose');
const {
  APP_ROLES,
  ACCOUNT_STATUS,
  PORTAL,
} = require('./auth.constants');

/**
 * App-portal user account.
 * Institute team (admin / educator) are invite-only and scoped via instituteId.
 * Admin operators live in AdminUser — portals stay isolated.
 */
const userSchema = new mongoose.Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Invalid Indian mobile number'],
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    fullName: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: Object.values(APP_ROLES),
      required: true,
    },
    accountStatus: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      required: true,
      default: ACCOUNT_STATUS.ACTIVE,
    },
    /** False until the user successfully verifies an OTP (register or login). */
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    mobileVerifiedAt: {
      type: Date,
      default: null,
    },
    /** False until the inbox is confirmed via email OTP or verify link. */
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    portal: {
      type: String,
      enum: [PORTAL.APP],
      default: PORTAL.APP,
    },
    verificationLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    examGoal: {
      type: String,
      trim: true,
      default: '',
    },
    /** Exams an educator prepares students for (multi-select). */
    examGoals: {
      type: [String],
      default: [],
    },
    profilePhotoPath: {
      type: String,
      default: '',
    },
    /** Public handle for /u/:username (Module 3). */
    username: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    coverPhotoPath: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    education: {
      type: String,
      trim: true,
      default: '',
    },
    languages: {
      type: [String],
      default: [],
    },
    hobbies: {
      type: String,
      trim: true,
      default: '',
    },
    /** Defence portfolio fields (Module 3 PROF-005). */
    preferredService: {
      type: String,
      trim: true,
      default: '',
    },
    targetEntry: {
      type: String,
      trim: true,
      default: '',
    },
    ssbBoard: {
      type: String,
      trim: true,
      default: '',
    },
    preparationStage: {
      type: String,
      trim: true,
      default: '',
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    recommendations: {
      type: Number,
      default: 0,
      min: 0,
    },
    conferenceOuts: {
      type: Number,
      default: 0,
      min: 0,
    },
    preferredBranch: {
      type: String,
      trim: true,
      default: '',
    },
    medicalStatus: {
      type: String,
      trim: true,
      default: '',
    },
    expectedJoining: {
      type: String,
      trim: true,
      default: '',
    },
    attemptDate: {
      type: Date,
      default: null,
    },
    /** Mentor office hours (CHAT-D07) — soft badge only. */
    mentorAvailability: {
      enabled: { type: Boolean, default: false },
      timezone: {
        type: String,
        default: 'Asia/Kolkata',
        trim: true,
        maxlength: 64,
      },
      windows: {
        type: [
          {
            day: { type: Number, min: 0, max: 6, required: true },
            start: { type: String, default: '09:00', trim: true },
            end: { type: String, default: '17:00', trim: true },
            _id: false,
          },
        ],
        default: [],
      },
    },
    /** Section visibility: public | followers | only_me (Module 3 PROF-011). */
    privacyBio: {
      type: String,
      enum: ['public', 'followers', 'only_me'],
      default: 'public',
    },
    privacyAbout: {
      type: String,
      enum: ['public', 'followers', 'only_me'],
      default: 'public',
    },
    privacyDefence: {
      type: String,
      enum: ['public', 'followers', 'only_me'],
      default: 'public',
    },
    privacyJourney: {
      type: String,
      enum: ['public', 'followers', 'only_me'],
      default: 'public',
    },
    privacyAchievements: {
      type: String,
      enum: ['public', 'followers', 'only_me'],
      default: 'public',
    },
    instituteName: {
      type: String,
      trim: true,
      default: '',
    },
    instituteLogoPath: {
      type: String,
      default: '',
    },
    officerPhotoPath: {
      type: String,
      default: '',
    },
    officerIdDocumentPath: {
      type: String,
      default: '',
    },
    /** Freelancer educator ID proof (synced from EducatorProfile for approvals UX). */
    idDocumentPath: {
      type: String,
      default: '',
    },
    /**
     * Public code for institutes (hire / join). Unique when set.
     * Only meaningful for role=institute owners.
     */
    instituteCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    /** Active EducatorProfile (freelancer or institute membership) for this session. */
    activeProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EducatorProfile',
      default: null,
    },
    /**
     * Owner User id for institute-scoped members (institute_admin / educator).
     * Null for aspirants, defence officers, and institute owners themselves.
     */
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    /** App user who invited this member (owner or institute admin). */
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    permissions: {
      type: [String],
      default: [],
    },
    /** Optional institute custom role template applied to this member. */
    customRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstituteRole',
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
    /** Field codes from REJECTION_FIELDS_BY_ROLE that failed review. */
    rejectedFields: {
      type: [String],
      default: [],
    },
    /** Snapshot of the last rejection kept after applicant resubmits. */
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
    lastLoginAt: {
      type: Date,
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

userSchema.index({ email: 1 });
userSchema.index({ role: 1, accountStatus: 1 });
userSchema.index({ isMobileVerified: 1 });
userSchema.index({ isEmailVerified: 1 });
userSchema.index({ instituteId: 1, role: 1, accountStatus: 1 });
userSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: { username: { $type: 'string', $gt: '' } },
  },
);
userSchema.index(
  { instituteCode: 1 },
  {
    unique: true,
    partialFilterExpression: { instituteCode: { $type: 'string', $gt: '' } },
  },
);

const User = mongoose.model('User', userSchema);

module.exports = { User };
