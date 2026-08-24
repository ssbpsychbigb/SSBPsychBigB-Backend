'use strict';

const mongoose = require('mongoose');

const CONVERSATION_KINDS = ['person', 'mentor', 'institute'];
const FOLDERS = ['focused', 'other'];
const ATTACHMENT_KINDS = ['image', 'file', 'gif'];
const MESSAGE_STATUSES = ['sent', 'deleted'];

const chatConversationSchema = new mongoose.Schema(
  {
    participantIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      ],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 2;
        },
        message: 'A conversation must have exactly two participants',
      },
    },
    /** Sorted `${idA}:${idB}` for unique 1:1 lookup. */
    participantKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    kind: {
      type: String,
      enum: CONVERSATION_KINDS,
      default: 'person',
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastMessagePreview: {
      type: String,
      default: '',
      maxlength: 200,
    },
    lastMessageSenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, collection: 'chat_conversations' },
);

const chatMembershipSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    folder: {
      type: String,
      enum: FOLDERS,
      default: 'focused',
    },
    starred: {
      type: Boolean,
      default: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    labeledMentors: {
      type: Boolean,
      default: false,
    },
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatMessage',
      default: null,
    },
    muted: {
      type: Boolean,
      default: false,
    },
    deletedForUserAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, collection: 'chat_memberships' },
);

chatMembershipSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
chatMembershipSchema.index({ userId: 1, deletedForUserAt: 1, updatedAt: -1 });
chatMembershipSchema.index({ userId: 1, unreadCount: 1 });

const chatAttachmentSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ATTACHMENT_KINDS,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    path: {
      type: String,
      default: '',
    },
    mime: {
      type: String,
      default: '',
    },
    size: {
      type: Number,
      default: 0,
    },
    previewUrl: {
      type: String,
      default: '',
    },
    gifEmoji: {
      type: String,
      default: '',
    },
    gifTone: {
      type: String,
      default: '',
    },
  },
  { _id: false },
);

const chatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    body: {
      type: String,
      default: '',
      maxlength: 4000,
    },
    clientMessageId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 80,
    },
    attachments: {
      type: [chatAttachmentSchema],
      default: [],
    },
    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: 'sent',
    },
  },
  { timestamps: true, collection: 'chat_messages' },
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index(
  { senderId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientMessageId: { $type: 'string', $gt: '' },
    },
  },
);

const ChatConversation = mongoose.model(
  'ChatConversation',
  chatConversationSchema,
);
const ChatMembership = mongoose.model('ChatMembership', chatMembershipSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

const CHAT_REPORT_REASONS = [
  'spam',
  'abuse',
  'harassment',
  'misinformation',
  'other',
];

const chatBlockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    blockedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'chat_blocks' },
);

chatBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

const chatReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      default: null,
    },
    reason: {
      type: String,
      enum: CHAT_REPORT_REASONS,
      required: true,
    },
    note: {
      type: String,
      default: '',
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['open', 'reviewed', 'dismissed'],
      default: 'open',
    },
  },
  { timestamps: true, collection: 'chat_reports' },
);

chatReportSchema.index({ reporterId: 1, reportedUserId: 1, createdAt: -1 });

const ChatBlock = mongoose.model('ChatBlock', chatBlockSchema);
const ChatReport = mongoose.model('ChatReport', chatReportSchema);

module.exports = {
  ChatConversation,
  ChatMembership,
  ChatMessage,
  ChatBlock,
  ChatReport,
  CONVERSATION_KINDS,
  FOLDERS,
  ATTACHMENT_KINDS,
  MESSAGE_STATUSES,
  CHAT_REPORT_REASONS,
};
