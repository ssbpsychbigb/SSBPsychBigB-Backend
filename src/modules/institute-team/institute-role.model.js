'use strict';

const mongoose = require('mongoose');
const { ASSIGNABLE_INSTITUTE_ROLES } = require('../auth/auth.constants');

/**
 * Institute-scoped custom role template (named permission bundle).
 * System roles institute_admin / educator stay fixed; this is extra templates only.
 */
const instituteRoleSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
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
    /**
     * Legacy field — custom roles are permission packs only (no Admin/Educator type).
     */
    baseRole: {
      type: String,
      enum: [...ASSIGNABLE_INSTITUTE_ROLES, ''],
      default: '',
    },
    permissions: {
      type: [String],
      default: [],
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

instituteRoleSchema.index(
  { instituteId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

const InstituteRole = mongoose.model('InstituteRole', instituteRoleSchema);

module.exports = {
  InstituteRole,
};
