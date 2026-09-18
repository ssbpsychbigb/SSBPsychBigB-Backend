'use strict';

const mongoose = require('mongoose');

const EVENT_LOCATION_TYPES = Object.freeze([
  'online',
  'in_person',
  'tbd',
]);
const EVENT_STATUS = Object.freeze(['scheduled', 'cancelled']);
const RSVP_STATUS = Object.freeze(['going', 'interested']);

const communityEventSchema = new mongoose.Schema(
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
      maxlength: 2000,
    },
    startsAt: {
      type: Date,
      required: true,
      index: true,
    },
    endsAt: {
      type: Date,
      default: null,
    },
    locationType: {
      type: String,
      enum: EVENT_LOCATION_TYPES,
      default: 'tbd',
    },
    locationText: {
      type: String,
      default: '',
      trim: true,
      maxlength: 240,
    },
    meetingUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: EVENT_STATUS,
      default: 'scheduled',
      index: true,
    },
    goingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    interestedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true, collection: 'community_events' },
);

communityEventSchema.index({ communityId: 1, status: 1, startsAt: 1 });

const communityEventRsvpSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunityEvent',
      required: true,
      index: true,
    },
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
    status: {
      type: String,
      enum: RSVP_STATUS,
      required: true,
    },
  },
  { timestamps: true, collection: 'community_event_rsvps' },
);

communityEventRsvpSchema.index({ eventId: 1, userId: 1 }, { unique: true });

const CommunityEvent = mongoose.model('CommunityEvent', communityEventSchema);
const CommunityEventRsvp = mongoose.model(
  'CommunityEventRsvp',
  communityEventRsvpSchema,
);

module.exports = {
  CommunityEvent,
  CommunityEventRsvp,
  EVENT_LOCATION_TYPES,
  EVENT_STATUS,
  RSVP_STATUS,
};
