'use strict';

const mongoose = require('mongoose');

/**
 * Platform admin custom role template (named permission bundle).
 * Super Admin creates these; Platform Admin / Moderator stay as fixed system roles.
 */
const adminRoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
    },
    permissions: {
      type: [String],
      default: [],
    },
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
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

adminRoleSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

const AdminRole = mongoose.model('AdminRole', adminRoleSchema);

module.exports = { AdminRole };
