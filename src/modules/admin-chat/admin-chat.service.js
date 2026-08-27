'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { User } = require('../auth/user.model');
const {
  ChatReport,
  ChatConversation,
  ChatMessage,
  CHAT_REPORT_REASONS,
} = require('../chat/chat.model');
const { ModerationLog } = require('../admin-feed/moderation-log.model');

const USER_SELECT =
  'fullName username role profilePhotoPath officerPhotoPath instituteLogoPath instituteName';

function asObjectId(id, code = 'NOT_FOUND') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Not found', HTTP_STATUS.NOT_FOUND, { code });
  }
  return new mongoose.Types.ObjectId(id);
}

function serializeUser(user) {
  if (!user) {
    return {
      id: '',
      fullName: 'Unknown',
      username: '',
      role: '',
      profilePhotoPath: null,
    };
  }
  return {
    id: String(user._id),
    fullName:
      String(user.instituteName || user.fullName || '').trim() ||
      user.username ||
      'Member',
    username: String(user.username || ''),
    role: String(user.role || ''),
    profilePhotoPath:
      user.profilePhotoPath ||
      user.officerPhotoPath ||
      user.instituteLogoPath ||
      null,
  };
}

function serializeMessage(doc) {
  const attachment =
    Array.isArray(doc.attachments) && doc.attachments[0]
      ? {
          kind: doc.attachments[0].kind,
          name: doc.attachments[0].name,
          path: doc.attachments[0].path || undefined,
        }
      : undefined;
  return {
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    senderId: String(doc.senderId),
    body: doc.body || '',
    sentAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
    status: doc.status === 'deleted' ? 'deleted' : 'sent',
    attachment,
  };
}

async function logChatAction(admin, action, input) {
  await ModerationLog.create({
    actorAdminId: admin._id,
    action,
    targetType: input.targetType,
    targetId: input.targetId,
    note: input.note || '',
    meta: input.meta || {},
  });
}

class AdminChatService {
  /**
   * List chat reports for moderator queue.
   */
  async listReports({ status = 'open', cursor, limit = 30 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const filter = {};
    if (status && status !== 'all') {
      if (!['open', 'reviewed', 'dismissed'].includes(status)) {
        throw new AppError('Invalid status filter', HTTP_STATUS.BAD_REQUEST, {
          code: 'INVALID_STATUS',
        });
      }
      filter.status = status;
    }

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await ChatReport.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(take + 1)
      .lean();

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    const userIds = new Set();
    const conversationIds = new Set();
    for (const row of page) {
      if (row.reporterId) userIds.add(String(row.reporterId));
      if (row.reportedUserId) userIds.add(String(row.reportedUserId));
      if (row.conversationId) conversationIds.add(String(row.conversationId));
    }

    const [users, conversations] = await Promise.all([
      User.find({
        _id: { $in: [...userIds].map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select(USER_SELECT)
        .lean(),
      conversationIds.size
        ? ChatConversation.find({
            _id: {
              $in: [...conversationIds].map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
          })
            .select('type kind title participantIds lastMessagePreview')
            .lean()
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const convMap = new Map(
      conversations.map((c) => [String(c._id), c]),
    );

    const items = page.map((row) => {
      const conversation = row.conversationId
        ? convMap.get(String(row.conversationId))
        : null;
      return {
        id: String(row._id),
        status: row.status,
        reason: row.reason,
        note: row.note || '',
        createdAt: row.createdAt
          ? new Date(row.createdAt).toISOString()
          : null,
        reviewedAt: row.reviewedAt
          ? new Date(row.reviewedAt).toISOString()
          : null,
        resolutionNote: row.resolutionNote || '',
        messageId: row.messageId ? String(row.messageId) : null,
        conversationId: row.conversationId
          ? String(row.conversationId)
          : null,
        reporter: serializeUser(userMap.get(String(row.reporterId))),
        reportedUser: serializeUser(userMap.get(String(row.reportedUserId))),
        conversation: conversation
          ? {
              id: String(conversation._id),
              type: conversation.type || 'dm',
              kind: conversation.kind || 'person',
              title: conversation.title || '',
              participantCount: (conversation.participantIds || []).length,
              preview: conversation.lastMessagePreview || '',
            }
          : null,
      };
    });

    return {
      items,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
      hasMore,
      reasons: CHAT_REPORT_REASONS,
    };
  }

  /**
   * Conversation transcript for investigating a report (no membership gate).
   */
  async listReportMessages(reportId, { before, limit = 40 } = {}) {
    const report = await ChatReport.findById(asObjectId(reportId, 'REPORT_NOT_FOUND'));
    if (!report) {
      throw new AppError('Report not found', HTTP_STATUS.NOT_FOUND, {
        code: 'REPORT_NOT_FOUND',
      });
    }
    if (!report.conversationId) {
      return { items: [], nextCursor: null, conversationId: null };
    }

    const take = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const query = {
      conversationId: report.conversationId,
      status: { $ne: 'deleted' },
    };

    if (before && mongoose.Types.ObjectId.isValid(before)) {
      const pivot = await ChatMessage.findById(before).select('createdAt');
      if (pivot) query.createdAt = { $lt: pivot.createdAt };
    }

    const rows = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(take + 1)
      .lean();

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    page.reverse();

    const senderIds = [...new Set(page.map((m) => String(m.senderId)))];
    const senders = await User.find({
      _id: senderIds.map((id) => new mongoose.Types.ObjectId(id)),
    })
      .select(USER_SELECT)
      .lean();
    const senderMap = new Map(senders.map((u) => [String(u._id), u]));

    return {
      conversationId: String(report.conversationId),
      items: page.map((doc) => {
        const base = serializeMessage(doc);
        const sender = serializeUser(senderMap.get(String(doc.senderId)));
        return {
          ...base,
          senderName: sender.fullName,
          senderUsername: sender.username,
        };
      }),
      nextCursor: hasMore ? String(page[0]._id) : null,
      highlightedMessageId: report.messageId
        ? String(report.messageId)
        : null,
    };
  }

  /**
   * Close / mark a chat report.
   * outcome: dismiss | review | resolve
   */
  async resolveReport({ admin, reportId, outcome, note = '' }) {
    const report = await ChatReport.findById(
      asObjectId(reportId, 'REPORT_NOT_FOUND'),
    );
    if (!report) {
      throw new AppError('Report not found', HTTP_STATUS.NOT_FOUND, {
        code: 'REPORT_NOT_FOUND',
      });
    }

    const nextStatus =
      outcome === 'dismiss'
        ? 'dismissed'
        : outcome === 'review' || outcome === 'resolve'
          ? 'reviewed'
          : null;

    if (!nextStatus) {
      throw new AppError(
        'outcome must be dismiss, review, or resolve',
        HTTP_STATUS.BAD_REQUEST,
        { code: 'INVALID_OUTCOME' },
      );
    }

    const resolutionNote = String(note || '')
      .trim()
      .slice(0, 1000);

    report.status = nextStatus;
    report.reviewedAt = new Date();
    report.reviewedByAdminId = admin._id;
    report.resolutionNote = resolutionNote;
    await report.save();

    const action =
      outcome === 'dismiss'
        ? 'dismiss_chat_report'
        : outcome === 'resolve'
          ? 'resolve_chat_report'
          : 'review_chat_report';

    await logChatAction(admin, action, {
      targetType: 'chat_report',
      targetId: report._id,
      note: resolutionNote,
      meta: {
        outcome,
        reportedUserId: String(report.reportedUserId),
        conversationId: report.conversationId
          ? String(report.conversationId)
          : null,
      },
    });

    return {
      id: String(report._id),
      status: report.status,
      outcome,
      resolutionNote,
      reviewedAt: report.reviewedAt.toISOString(),
    };
  }
}

const adminChatService = new AdminChatService();

module.exports = { adminChatService };
