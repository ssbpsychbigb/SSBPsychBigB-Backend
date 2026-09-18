'use strict';

const mongoose = require('mongoose');

const TIMELINE_EVENT_TYPES = [
  'joined_bigb',
  'started_prep',
  'assessment',
  'attended_ssb',
  'conference_out',
  'recommended',
  'medical',
  'joining',
  'officer',
  'mentor',
  'custom',
];

const timelineSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: TIMELINE_EVENT_TYPES,
      default: 'custom',
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    eventDate: { type: Date, required: true },
    source: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'manual',
    },
  },
  { timestamps: true, collection: 'user_timeline' },
);

timelineSchema.index({ userId: 1, eventDate: -1 });

const UserTimeline = mongoose.model('UserTimeline', timelineSchema);

module.exports = { UserTimeline, TIMELINE_EVENT_TYPES };
