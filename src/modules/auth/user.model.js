'use strict';

const mongoose = require('mongoose');
const {
  APP_ROLES,
  ACCOUNT_STATUS,
  PORTAL,
} = require('./auth.constants');

/**
 * App-portal user account (aspirant / institute / defence officer).
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
    permissions: {
      type: [String],
      default: [],
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
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

const User = mongoose.model('User', userSchema);

module.exports = { User };
