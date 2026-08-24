'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { User } = require('../auth/user.model');
const { APP_ROLES } = require('../auth/auth.constants');
const {
  ChatConversation,
  ChatMembership,
  ChatMessage,
  ChatBlock,
  ChatReport,
  CHAT_REPORT_REASONS,
} = require('./chat.model');
const presence = require('./chat.presence');
const { emitToUser } = require('./chat.realtime');

const EXAM_LABELS = {
  nda: 'NDA',
  cds: 'CDS',
  afcat: 'AFCAT',
  ssb: 'SSB Interview',
  capf: 'CAPF',
  agniveer: 'Agniveer',
  inet: 'INET',
  other: 'Other / Exploring',
};

const MAX_BODY = 4000;
const DEFAULT_LIST_LIMIT = 40;
const DEFAULT_MSG_LIMIT = 40;

/**
 * @param {import('mongoose').Types.ObjectId|string} a
 * @param {import('mongoose').Types.ObjectId|string} b
 */
function participantKeyFor(a, b) {
  return [String(a), String(b)].sort().join(':');
}

/**
 * @param {string} role
 */
function conversationKindForRole(role) {
  if (role === APP_ROLES.INSTITUTE) return 'institute';
  if (
    role === APP_ROLES.EDUCATOR ||
    role === APP_ROLES.DEFENCE_OFFICER ||
    role === APP_ROLES.INSTITUTE_ADMIN
  ) {
    return 'mentor';
  }
  return 'person';
}

/**
 * @param {import('mongoose').Document} user
 */
function peerHeadline(user) {
  if (!user) return '';
  if (user.role === APP_ROLES.INSTITUTE) {
    return (
      String(user.instituteName || user.fullName || '').trim() || 'Institute'
    );
  }
  if (user.role === APP_ROLES.DEFENCE_OFFICER) {
    return 'Defence Officer';
  }
  if (user.role === APP_ROLES.EDUCATOR) {
    return 'Educator · Mentor';
  }
  const exam = EXAM_LABELS[user.examGoal] || '';
  const city = String(user.city || '').trim();
  const parts = ['Aspirant', exam, city].filter(Boolean);
  return parts.join(' · ');
}

/**
 * @param {import('mongoose').Document} user
 */
function serializePeer(user) {
  if (!user) {
    return {
      id: '',
      name: 'Unknown',
      username: '',
      headline: '',
      role: '',
      profilePhotoPath: null,
    };
  }

  const photo =
    user.profilePhotoPath ||
    user.officerPhotoPath ||
    user.instituteLogoPath ||
    '';

  return {
    id: String(user._id),
    name:
      String(user.instituteName || user.fullName || '').trim() ||
      user.username ||
      'Member',
    username: String(user.username || ''),
    headline: peerHeadline(user),
    role: String(user.role || ''),
    profilePhotoPath: photo || null,
  };
}

/**
 * @param {string} text
 * @param {number} [max]
 */
function truncatePreview(text, max = 120) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * @param {object} message
 * @param {string} viewerId
 */
function serializeMessage(message, viewerId) {
  const senderId = String(message.senderId);
  const attachment = Array.isArray(message.attachments) && message.attachments[0]
    ? {
        kind: message.attachments[0].kind,
        name: message.attachments[0].name,
        sizeLabel:
          message.attachments[0].size > 0
            ? `${Math.max(1, Math.round(message.attachments[0].size / 1024))} KB`
            : undefined,
        path: message.attachments[0].path || undefined,
        previewUrl:
          message.attachments[0].previewUrl ||
          (message.attachments[0].kind === 'image' &&
          message.attachments[0].path
            ? message.attachments[0].path
            : undefined),
        gifEmoji: message.attachments[0].gifEmoji || undefined,
        gifTone: message.attachments[0].gifTone || undefined,
        mime: message.attachments[0].mime || undefined,
        size: message.attachments[0].size || undefined,
      }
    : undefined;

  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    senderId,
    author: senderId === String(viewerId) ? 'you' : 'them',
    body: message.body || '',
    sentAt: message.createdAt
      ? new Date(message.createdAt).toISOString()
      : new Date().toISOString(),
    clientMessageId: message.clientMessageId || undefined,
    attachment,
    status: message.status === 'deleted' ? 'deleted' : 'sent',
  };
}

/**
 * @param {object} conversation
 * @param {object} membership
 * @param {object} peer
 */
function serializeConversation(conversation, membership, peer) {
  return {
    id: String(conversation._id),
    peer,
    name: peer.name,
    username: peer.username,
    headline: peer.headline,
    kind: conversation.kind || 'person',
    profilePhotoPath: peer.profilePhotoPath,
    preview: conversation.lastMessagePreview || '',
    updatedAt: conversation.lastMessageAt
      ? new Date(conversation.lastMessageAt).toISOString()
      : new Date(conversation.updatedAt).toISOString(),
    unread: (membership.unreadCount || 0) > 0,
    unreadCount: membership.unreadCount || 0,
    starred: Boolean(membership.starred),
    folder: membership.folder || 'focused',
    archived: Boolean(membership.archived),
    labeledMentors: Boolean(membership.labeledMentors),
    muted: Boolean(membership.muted),
    online: peer.id ? presence.isOnline(peer.id) : false,
  };
}

/**
 * @param {string} value
 */
function requireObjectId(value, label = 'id') {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(`Invalid ${label}`, HTTP_STATUS.BAD_REQUEST, {
      code: 'INVALID_ID',
    });
  }
  return new mongoose.Types.ObjectId(value);
}

class ChatService {
  /**
   * @param {string|import('mongoose').Types.ObjectId} userId
   * @param {string|import('mongoose').Types.ObjectId} peerId
   */
  async assertNotBlocked(userId, peerId) {
    const a = String(userId);
    const b = String(peerId);
    if (!a || !b || a === b) return;

    const blocked = await ChatBlock.findOne({
      $or: [
        {
          blockerId: new mongoose.Types.ObjectId(a),
          blockedId: new mongoose.Types.ObjectId(b),
        },
        {
          blockerId: new mongoose.Types.ObjectId(b),
          blockedId: new mongoose.Types.ObjectId(a),
        },
      ],
    }).lean();

    if (blocked) {
      throw new AppError(
        'Messaging is not available with this user',
        HTTP_STATUS.FORBIDDEN,
        { code: 'USER_BLOCKED' },
      );
    }
  }

  /**
   * @param {import('mongoose').Document} user
   * @param {string} conversationId
   */
  async requireMembership(user, conversationId) {
    const oid = requireObjectId(conversationId, 'conversationId');
    const membership = await ChatMembership.findOne({
      conversationId: oid,
      userId: user._id,
      deletedForUserAt: null,
    });
    if (!membership) {
      throw new AppError('Conversation not found', HTTP_STATUS.NOT_FOUND, {
        code: 'CONVERSATION_NOT_FOUND',
      });
    }
    const conversation = await ChatConversation.findById(oid);
    if (!conversation) {
      throw new AppError('Conversation not found', HTTP_STATUS.NOT_FOUND, {
        code: 'CONVERSATION_NOT_FOUND',
      });
    }
    return { membership, conversation };
  }

  /**
   * @param {import('mongoose').Document} conversation
   * @param {string} viewerId
   */
  peerIdFromConversation(conversation, viewerId) {
    const viewer = String(viewerId);
    const peerId = conversation.participantIds
      .map((id) => String(id))
      .find((id) => id !== viewer);
    return peerId || null;
  }

  /**
   * @param {string[]} userIds
   */
  async loadUsersById(userIds) {
    const unique = [...new Set(userIds.filter(Boolean).map(String))];
    if (unique.length === 0) return new Map();
    const users = await User.find({
      _id: { $in: unique.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select(
      'fullName username role examGoal city profilePhotoPath officerPhotoPath instituteLogoPath instituteName',
    );
    const map = new Map();
    for (const user of users) {
      map.set(String(user._id), user);
    }
    return map;
  }

  /**
   * Inbox list for the current user.
   */
  async listConversations(user, { filter = 'focused', q = '', limit } = {}) {
    const take = Math.min(
      Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1),
      100,
    );

    const memQuery = {
      userId: user._id,
      deletedForUserAt: null,
      archived: false,
    };

    if (filter === 'starred') memQuery.starred = true;
    if (filter === 'unread') memQuery.unreadCount = { $gt: 0 };
    if (filter === 'other') memQuery.folder = 'other';
    if (filter === 'focused') memQuery.folder = 'focused';

    const memberships = await ChatMembership.find(memQuery).lean();
    if (memberships.length === 0) {
      return { items: [], nextCursor: null };
    }

    const membershipByConv = new Map(
      memberships.map((m) => [String(m.conversationId), m]),
    );
    const convIds = memberships.map((m) => m.conversationId);

    const conversations = await ChatConversation.find({
      _id: { $in: convIds },
    })
      .sort({ lastMessageAt: -1 })
      .lean();

    let rows = conversations;
    if (filter === 'mentors') {
      rows = rows.filter(
        (c) =>
          c.kind === 'mentor' ||
          Boolean(membershipByConv.get(String(c._id))?.labeledMentors),
      );
    } else if (filter === 'institutes') {
      rows = rows.filter((c) => c.kind === 'institute');
    }

    const peerIds = rows
      .map((c) => this.peerIdFromConversation(c, user._id))
      .filter(Boolean);
    const peers = await this.loadUsersById(peerIds);

    const query = String(q || '')
      .trim()
      .toLowerCase();

    const items = [];
    for (const conversation of rows) {
      if (items.length >= take) break;
      const membership = membershipByConv.get(String(conversation._id));
      if (!membership) continue;
      const peerId = this.peerIdFromConversation(conversation, user._id);
      const peerUser = peerId ? peers.get(peerId) : null;
      const peer = serializePeer(peerUser);
      if (query) {
        const hay = `${peer.name} ${peer.username} ${peer.headline} ${conversation.lastMessagePreview || ''}`.toLowerCase();
        if (!hay.includes(query)) continue;
      }
      items.push(serializeConversation(conversation, membership, peer));
    }

    return { items, nextCursor: null };
  }

  /**
   * Get-or-create a 1:1 conversation with a peer.
   */
  async getOrCreateConversation(user, { peerUserId, peerUsername } = {}) {
    let peer = null;

    if (peerUserId) {
      const oid = requireObjectId(peerUserId, 'peerUserId');
      if (String(oid) === String(user._id)) {
        throw new AppError(
          'You cannot message yourself',
          HTTP_STATUS.BAD_REQUEST,
          { code: 'INVALID_PEER' },
        );
      }
      peer = await User.findById(oid);
    } else if (peerUsername) {
      const handle = String(peerUsername || '')
        .trim()
        .toLowerCase()
        .replace(/^@/, '');
      if (!handle) {
        throw new AppError('Username is required', HTTP_STATUS.BAD_REQUEST, {
          code: 'USERNAME_REQUIRED',
        });
      }
      peer = await User.findOne({ username: handle });
      if (!peer && mongoose.Types.ObjectId.isValid(handle)) {
        peer = await User.findById(handle);
      }
    } else {
      throw new AppError(
        'peerUserId or peerUsername is required',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'PEER_REQUIRED' },
      );
    }

    if (!peer || peer.accountStatus === 'deleted') {
      throw new AppError('User not found', HTTP_STATUS.NOT_FOUND, {
        code: 'USER_NOT_FOUND',
      });
    }

    if (String(peer._id) === String(user._id)) {
      throw new AppError(
        'You cannot message yourself',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_PEER' },
      );
    }

    await this.assertNotBlocked(user._id, peer._id);

    const key = participantKeyFor(user._id, peer._id);
    let conversation = await ChatConversation.findOne({ participantKey: key });

    if (!conversation) {
      conversation = await ChatConversation.create({
        participantIds: [user._id, peer._id],
        participantKey: key,
        kind: conversationKindForRole(peer.role),
        lastMessageAt: new Date(),
        lastMessagePreview: '',
        lastMessageSenderId: null,
      });
    }

    await ChatMembership.findOneAndUpdate(
      { conversationId: conversation._id, userId: user._id },
      {
        $setOnInsert: {
          conversationId: conversation._id,
          userId: user._id,
          folder: 'focused',
          starred: false,
          labeledMentors: conversation.kind === 'mentor',
          unreadCount: 0,
        },
        $set: { deletedForUserAt: null, archived: false },
      },
      { upsert: true, new: true },
    );

    await ChatMembership.findOneAndUpdate(
      { conversationId: conversation._id, userId: peer._id },
      {
        $setOnInsert: {
          conversationId: conversation._id,
          userId: peer._id,
          folder: 'focused',
          starred: false,
          archived: false,
          labeledMentors: false,
          unreadCount: 0,
        },
      },
      { upsert: true, new: true },
    );

    const membership = await ChatMembership.findOne({
      conversationId: conversation._id,
      userId: user._id,
    });

    return serializeConversation(
      conversation,
      membership,
      serializePeer(peer),
    );
  }

  /**
   * Single conversation summary for the viewer.
   */
  async getConversation(user, conversationId) {
    const { membership, conversation } = await this.requireMembership(
      user,
      conversationId,
    );
    const peerId = this.peerIdFromConversation(conversation, user._id);
    const peers = await this.loadUsersById(peerId ? [peerId] : []);
    const peer = serializePeer(peerId ? peers.get(peerId) : null);
    return serializeConversation(conversation, membership, peer);
  }

  /**
   * Message history (newest page first in DB query; returned oldest→newest).
   */
  async listMessages(user, conversationId, { before, limit } = {}) {
    await this.requireMembership(user, conversationId);
    const take = Math.min(
      Math.max(Number(limit) || DEFAULT_MSG_LIMIT, 1),
      100,
    );
    const oid = requireObjectId(conversationId, 'conversationId');

    const query = {
      conversationId: oid,
      status: 'sent',
    };

    if (before && mongoose.Types.ObjectId.isValid(before)) {
      const pivot = await ChatMessage.findById(before).select('createdAt');
      if (pivot) {
        query.createdAt = { $lt: pivot.createdAt };
      }
    }

    const rows = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(take + 1)
      .lean();

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    page.reverse();

    return {
      items: page.map((row) => serializeMessage(row, user._id)),
      nextCursor: hasMore ? String(page[0]._id) : null,
    };
  }

  /**
   * Send a text (and optional attachment metadata) message.
   */
  async sendMessage(
    user,
    conversationId,
    { body = '', clientMessageId, attachment } = {},
  ) {
    const { membership, conversation } = await this.requireMembership(
      user,
      conversationId,
    );

    const peerId = this.peerIdFromConversation(conversation, user._id);
    if (peerId) {
      await this.assertNotBlocked(user._id, peerId);
    }

    const text = String(body || '').trim();
    let attachments = [];

    if (attachment && typeof attachment === 'object') {
      const kind = String(attachment.kind || '');
      if (!['image', 'file', 'gif'].includes(kind)) {
        throw new AppError('Invalid attachment kind', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_ATTACHMENT',
        });
      }
      attachments = [
        {
          kind,
          name: String(attachment.name || 'attachment').slice(0, 240),
          path: String(attachment.path || '').slice(0, 500),
          mime: String(attachment.mime || '').slice(0, 120),
          size: Number(attachment.size) || 0,
          previewUrl: String(attachment.previewUrl || '').slice(0, 500),
          gifEmoji: String(attachment.gifEmoji || '').slice(0, 16),
          gifTone: String(attachment.gifTone || '').slice(0, 40),
        },
      ];
    }

    if (!text && attachments.length === 0) {
      throw new AppError('Message body is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'EMPTY_MESSAGE',
      });
    }

    if (text.length > MAX_BODY) {
      throw new AppError('Message is too long', HTTP_STATUS.BAD_REQUEST, {
        code: 'MESSAGE_TOO_LONG',
      });
    }

    const clientId = clientMessageId
      ? String(clientMessageId).trim().slice(0, 80)
      : null;

    if (clientId) {
      const existing = await ChatMessage.findOne({
        senderId: user._id,
        clientMessageId: clientId,
      });
      if (existing) {
        return serializeMessage(existing, user._id);
      }
    }

    let preview = text;
    if (!preview && attachments[0]) {
      preview =
        attachments[0].kind === 'gif'
          ? `GIF · ${attachments[0].name}`
          : `📎 ${attachments[0].name}`;
    }
    const storedPreview = truncatePreview(preview);

    let message;
    try {
      message = await ChatMessage.create({
        conversationId: conversation._id,
        senderId: user._id,
        body: text,
        clientMessageId: clientId,
        attachments,
        status: 'sent',
      });
    } catch (err) {
      if (err && err.code === 11000 && clientId) {
        const existing = await ChatMessage.findOne({
          senderId: user._id,
          clientMessageId: clientId,
        });
        if (existing) return serializeMessage(existing, user._id);
      }
      throw err;
    }

    const now = message.createdAt || new Date();
    conversation.lastMessageAt = now;
    conversation.lastMessagePreview = storedPreview;
    conversation.lastMessageSenderId = user._id;
    await conversation.save();

    membership.unreadCount = 0;
    membership.lastReadAt = now;
    membership.lastReadMessageId = message._id;
    membership.archived = false;
    membership.deletedForUserAt = null;
    await membership.save();

    if (peerId) {
      await ChatMembership.findOneAndUpdate(
        {
          conversationId: conversation._id,
          userId: new mongoose.Types.ObjectId(peerId),
        },
        {
          $inc: { unreadCount: 1 },
          $set: {
            archived: false,
            deletedForUserAt: null,
            updatedAt: now,
          },
        },
      );
    }

    const payloadForSender = serializeMessage(message, user._id);
    void this.emitMessageRealtime({
      conversation,
      senderId: String(user._id),
      peerId,
      messageDoc: message,
      preview: storedPreview,
    });

    return payloadForSender;
  }

  /**
   * Push message + inbox + unread events to both participants.
   */
  async emitMessageRealtime({
    conversation,
    senderId,
    peerId,
    messageDoc,
    preview,
  }) {
    try {
      const peers = await this.loadUsersById(
        [senderId, peerId].filter(Boolean),
      );
      const senderUser = peers.get(String(senderId));
      const peerUser = peerId ? peers.get(String(peerId)) : null;

      const senderMembership = await ChatMembership.findOne({
        conversationId: conversation._id,
        userId: senderId,
      }).lean();
      const peerMembership = peerId
        ? await ChatMembership.findOne({
            conversationId: conversation._id,
            userId: peerId,
          }).lean()
        : null;

      if (senderMembership) {
        const senderView = serializeConversation(
          conversation,
          senderMembership,
          serializePeer(peerUser),
        );
        emitToUser(senderId, 'message:new', {
          conversationId: String(conversation._id),
          message: serializeMessage(messageDoc, senderId),
        });
        emitToUser(senderId, 'conversation:updated', {
          conversation: senderView,
        });
        const senderUnread = await this.unreadCount({
          _id: new mongoose.Types.ObjectId(senderId),
        });
        emitToUser(senderId, 'unread:total', senderUnread);
      }

      if (peerId && peerMembership) {
        try {
          await this.assertNotBlocked(senderId, peerId);
        } catch {
          return;
        }
        const peerView = serializeConversation(
          conversation,
          peerMembership,
          serializePeer(senderUser),
        );
        // Ensure preview reflects latest (membership may be lean stale on unread)
        peerView.preview = preview || peerView.preview;
        peerView.updatedAt = conversation.lastMessageAt
          ? new Date(conversation.lastMessageAt).toISOString()
          : peerView.updatedAt;

        emitToUser(peerId, 'message:new', {
          conversationId: String(conversation._id),
          message: serializeMessage(messageDoc, peerId),
        });
        emitToUser(peerId, 'conversation:updated', {
          conversation: peerView,
        });
        const peerUnread = await this.unreadCount({
          _id: new mongoose.Types.ObjectId(peerId),
        });
        emitToUser(peerId, 'unread:total', peerUnread);
      }
    } catch (err) {
      // Realtime must never break send.
      const { logger } = require('../../common/utils/logger');
      logger.warn('Chat realtime emit failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Mark conversation as read for the viewer.
   */
  async markRead(user, conversationId) {
    const { membership, conversation } = await this.requireMembership(
      user,
      conversationId,
    );

    const last = await ChatMessage.findOne({
      conversationId: conversation._id,
      status: 'sent',
    })
      .sort({ createdAt: -1 })
      .select('_id createdAt');

    membership.unreadCount = 0;
    membership.lastReadAt = new Date();
    if (last) membership.lastReadMessageId = last._id;
    await membership.save();

    const peerId = this.peerIdFromConversation(conversation, user._id);
    const peers = await this.loadUsersById(peerId ? [peerId] : []);
    const summary = serializeConversation(
      conversation,
      membership,
      serializePeer(peerId ? peers.get(peerId) : null),
    );

    try {
      emitToUser(String(user._id), 'conversation:updated', {
        conversation: summary,
      });
      const total = await this.unreadCount(user);
      emitToUser(String(user._id), 'unread:total', total);
    } catch {
      // ignore realtime errors
    }

    return summary;
  }

  /**
   * Patch membership flags (star, folder, archive, mentor label).
   */
  async patchConversation(user, conversationId, body = {}) {
    const { membership, conversation } = await this.requireMembership(
      user,
      conversationId,
    );

    if (body.starred !== undefined) membership.starred = Boolean(body.starred);
    if (body.archived !== undefined) {
      membership.archived = Boolean(body.archived);
    }
    if (body.labeledMentors !== undefined) {
      membership.labeledMentors = Boolean(body.labeledMentors);
    }
    if (body.muted !== undefined) membership.muted = Boolean(body.muted);
    if (body.folder !== undefined) {
      const folder = String(body.folder);
      if (folder !== 'focused' && folder !== 'other') {
        throw new AppError('Invalid folder', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_FOLDER',
        });
      }
      membership.folder = folder;
    }
    if (body.unread === true) {
      membership.unreadCount = Math.max(1, membership.unreadCount || 1);
    }
    if (body.unread === false) {
      membership.unreadCount = 0;
    }

    await membership.save();

    const peerId = this.peerIdFromConversation(conversation, user._id);
    const peers = await this.loadUsersById(peerId ? [peerId] : []);
    return serializeConversation(
      conversation,
      membership,
      serializePeer(peerId ? peers.get(peerId) : null),
    );
  }

  /**
   * Soft-hide conversation for the current user.
   */
  async deleteConversation(user, conversationId) {
    const { membership } = await this.requireMembership(user, conversationId);
    membership.deletedForUserAt = new Date();
    membership.unreadCount = 0;
    await membership.save();

    try {
      const total = await this.unreadCount(user);
      emitToUser(String(user._id), 'unread:total', total);
    } catch {
      // ignore
    }

    return { id: String(membership.conversationId), deleted: true };
  }

  /**
   * Report peer + block + hide conversation for the reporter.
   */
  async reportAndBlock(
    user,
    conversationId,
    { reason = 'other', note = '' } = {},
  ) {
    const { membership, conversation } = await this.requireMembership(
      user,
      conversationId,
    );
    const peerId = this.peerIdFromConversation(conversation, user._id);
    if (!peerId) {
      throw new AppError('Peer not found', HTTP_STATUS.NOT_FOUND, {
        code: 'PEER_NOT_FOUND',
      });
    }

    const cleanReason = String(reason || 'other');
    if (!CHAT_REPORT_REASONS.includes(cleanReason)) {
      throw new AppError('Invalid report reason', HTTP_STATUS.BAD_REQUEST, {
        code: 'INVALID_REASON',
      });
    }

    await ChatBlock.findOneAndUpdate(
      {
        blockerId: user._id,
        blockedId: new mongoose.Types.ObjectId(peerId),
      },
      {
        $setOnInsert: {
          blockerId: user._id,
          blockedId: new mongoose.Types.ObjectId(peerId),
        },
      },
      { upsert: true, new: true },
    );

    await ChatReport.create({
      reporterId: user._id,
      reportedUserId: new mongoose.Types.ObjectId(peerId),
      conversationId: conversation._id,
      reason: cleanReason,
      note: String(note || '').trim().slice(0, 500),
      status: 'open',
    });

    membership.deletedForUserAt = new Date();
    membership.unreadCount = 0;
    await membership.save();

    try {
      const total = await this.unreadCount(user);
      emitToUser(String(user._id), 'unread:total', total);
    } catch {
      // ignore
    }

    return {
      id: String(conversation._id),
      blocked: true,
      reported: true,
      deleted: true,
    };
  }

  /**
   * Persist a single chat attachment and return metadata for sendMessage.
   * @param {import('mongoose').Document} _user
   * @param {Express.Multer.File | undefined} file
   */
  async uploadAttachment(_user, file) {
    if (!file) {
      throw new AppError('File is required', HTTP_STATUS.BAD_REQUEST, {
        code: 'FILE_REQUIRED',
      });
    }

    const { toChatPublicPath, detectKind, formatBytes } = require('./chat.upload');
    const mime = String(file.mimetype || '').toLowerCase();
    const kind = detectKind(mime);
    const publicPath = toChatPublicPath(file);

    if (!publicPath) {
      throw new AppError('Upload failed', HTTP_STATUS.BAD_REQUEST, {
        code: 'UPLOAD_FAILED',
      });
    }

    return {
      kind,
      name: String(file.originalname || file.filename || 'attachment').slice(
        0,
        240,
      ),
      path: publicPath,
      mime,
      size: Number(file.size) || 0,
      sizeLabel: formatBytes(file.size),
    };
  }

  /**
   * Total unread conversations / messages for nav badge.
   */
  async unreadCount(user) {
    const rows = await ChatMembership.aggregate([
      {
        $match: {
          userId: user._id,
          deletedForUserAt: null,
          archived: false,
          unreadCount: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          unreadCount: { $sum: '$unreadCount' },
        },
      },
    ]);
    return { unreadCount: rows[0]?.unreadCount || 0 };
  }
}

const chatService = new ChatService();

module.exports = { chatService };
