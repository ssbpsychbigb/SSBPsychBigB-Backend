'use strict';

const mongoose = require('mongoose');

const COMMUNITY_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
});

const COMMUNITY_STATUS = Object.freeze({
  ACTIVE: 'active',
  ARCHIVED: 'archived',
});

const MEMBERSHIP_ROLES = Object.freeze({
  OWNER: 'owner',
  MODERATOR: 'moderator',
  MEMBER: 'member',
});

const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 64,
      index: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    coverPhotoPath: {
      type: String,
      default: '',
    },
    avatarPath: {
      type: String,
      default: '',
    },
    examGoals: {
      type: [String],
      default: [],
    },
    visibility: {
      type: String,
      enum: Object.values(COMMUNITY_VISIBILITY),
      default: COMMUNITY_VISIBILITY.PUBLIC,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ownerRole: {
      type: String,
      default: '',
    },
    memberCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(COMMUNITY_STATUS),
      default: COMMUNITY_STATUS.ACTIVE,
      index: true,
    },
  },
  { timestamps: true, collection: 'communities' },
);

communitySchema.index({ status: 1, memberCount: -1, createdAt: -1 });
communitySchema.index({ name: 'text', description: 'text' });

const communityMembershipSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(MEMBERSHIP_ROLES),
      default: MEMBERSHIP_ROLES.MEMBER,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true, collection: 'community_memberships' },
);

communityMembershipSchema.index({ communityId: 1, userId: 1 }, { unique: true });
communityMembershipSchema.index({ userId: 1, joinedAt: -1 });

const Community = mongoose.model('Community', communitySchema);
const CommunityMembership = mongoose.model(
  'CommunityMembership',
  communityMembershipSchema,
);

module.exports = {
  Community,
  CommunityMembership,
  COMMUNITY_VISIBILITY,
  COMMUNITY_STATUS,
  MEMBERSHIP_ROLES,
};
