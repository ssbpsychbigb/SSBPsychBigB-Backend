'use strict';

const mongoose = require('mongoose');

const RESOURCE_KINDS = Object.freeze(['link', 'pdf', 'doc']);

const communityResourceSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true,
      index: true,
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: RESOURCE_KINDS,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 800,
    },
    url: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    filePath: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    fileName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 240,
    },
    mime: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    size: {
      type: Number,
      default: 0,
      min: 0,
    },
    pinnedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true, collection: 'community_resources' },
);

communityResourceSchema.index({ communityId: 1, pinnedAt: -1, createdAt: -1 });
communityResourceSchema.index({
  communityId: 1,
  title: 'text',
  description: 'text',
  fileName: 'text',
});

const CommunityResource = mongoose.model(
  'CommunityResource',
  communityResourceSchema,
);

module.exports = {
  CommunityResource,
  RESOURCE_KINDS,
};
