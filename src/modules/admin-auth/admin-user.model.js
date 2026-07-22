'use strict';

const mongoose = require('mongoose');
const {
  ADMIN_ROLES,
  ACCOUNT_STATUS,
  PORTAL,
  ROLE_DEFAULT_PERMISSIONS,
} = require('../auth/auth.constants');

/**
 * Admin-portal operator account (password login, no OTP).
 * Kept separate from app Users so subdomain portals never share identity shape.
 */
const adminUserSchema = new mongoose.Schema(
  {
    loginId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 64,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    mobileNumber: {
      type: String,
      trim: true,
      // * Sparse unique — Super Admin seed may omit until set; staff create requires it.
      unique: true,
      sparse: true,
      minlength: 10,
      maxlength: 10,
    },
    role: {
      type: String,
      enum: Object.values(ADMIN_ROLES),
      required: true,
    },
    accountStatus: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      required: true,
      default: ACCOUNT_STATUS.ACTIVE,
    },
    portal: {
      type: String,
      enum: [PORTAL.ADMIN],
      default: PORTAL.ADMIN,
    },
    permissions: {
      type: [String],
      default() {
        return [...(ROLE_DEFAULT_PERMISSIONS[this.role] || [])];
      },
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
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

adminUserSchema.index({ role: 1, accountStatus: 1 });

const AdminUser = mongoose.model('AdminUser', adminUserSchema);

module.exports = { AdminUser };
