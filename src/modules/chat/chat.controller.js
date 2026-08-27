'use strict';

const { asyncHandler } = require('../../common/middleware/asyncHandler');
const { ApiResponse } = require('../../common/utils/ApiResponse');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { chatService } = require('./chat.service');

/**
 * Chat HTTP handlers — Phase M1 REST.
 */
class ChatController {
  listConversations = asyncHandler(async (req, res) => {
    const data = await chatService.listConversations(req.appUser, {
      filter: req.query.filter,
      q: req.query.q,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Conversations',
      data,
    });
  });

  createConversation = asyncHandler(async (req, res) => {
    const data = await chatService.getOrCreateConversation(req.appUser, {
      peerUserId: req.body?.peerUserId,
      peerUsername: req.body?.peerUsername,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Conversation ready',
      data,
    });
  });

  createGroupConversation = asyncHandler(async (req, res) => {
    const data = await chatService.createGroupConversation(req.appUser, {
      title: req.body?.title,
      memberIds: req.body?.memberIds,
      communityId: req.body?.communityId,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Group conversation ready',
      data,
    });
  });

  getConversation = asyncHandler(async (req, res) => {
    const data = await chatService.getConversation(
      req.appUser,
      req.params.id,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Conversation',
      data,
    });
  });

  listMessages = asyncHandler(async (req, res) => {
    const data = await chatService.listMessages(req.appUser, req.params.id, {
      before: req.query.before,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Messages',
      data,
    });
  });

  searchMessages = asyncHandler(async (req, res) => {
    const data = await chatService.searchMessages(req.appUser, {
      q: req.query.q,
      conversationId: req.query.conversationId || null,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Message search',
      data,
    });
  });

  sendMessage = asyncHandler(async (req, res) => {
    const data = await chatService.sendMessage(req.appUser, req.params.id, {
      body: req.body?.body,
      clientMessageId: req.body?.clientMessageId,
      attachment: req.body?.attachment,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'Message sent',
      data,
    });
  });

  editMessage = asyncHandler(async (req, res) => {
    const data = await chatService.editMessage(
      req.appUser,
      req.params.id,
      req.params.messageId,
      { body: req.body?.body },
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Message updated',
      data,
    });
  });

  deleteMessage = asyncHandler(async (req, res) => {
    const data = await chatService.deleteMessage(
      req.appUser,
      req.params.id,
      req.params.messageId,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Message deleted',
      data,
    });
  });

  markRead = asyncHandler(async (req, res) => {
    const data = await chatService.markRead(req.appUser, req.params.id);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Marked as read',
      data,
    });
  });

  patchConversation = asyncHandler(async (req, res) => {
    const data = await chatService.patchConversation(
      req.appUser,
      req.params.id,
      req.body || {},
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Conversation updated',
      data,
    });
  });

  deleteConversation = asyncHandler(async (req, res) => {
    const data = await chatService.deleteConversation(
      req.appUser,
      req.params.id,
    );
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Conversation deleted',
      data,
    });
  });

  unreadCount = asyncHandler(async (req, res) => {
    const data = await chatService.unreadCount(req.appUser);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Unread count',
      data,
    });
  });

  uploadAttachment = asyncHandler(async (req, res) => {
    const data = await chatService.uploadAttachment(req.appUser, req.file);
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.CREATED,
      message: 'File uploaded',
      data,
    });
  });

  reportAndBlock = asyncHandler(async (req, res) => {
    const data = await chatService.reportAndBlock(req.appUser, req.params.id, {
      reason: req.body?.reason,
      note: req.body?.note,
    });
    return ApiResponse.success(res, {
      statusCode: HTTP_STATUS.OK,
      message: 'Reported and blocked',
      data,
    });
  });
}

const chatController = new ChatController();

module.exports = { chatController };
