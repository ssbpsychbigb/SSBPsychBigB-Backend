'use strict';

const { Router } = require('express');
const { chatController } = require('./chat.controller');
const { chatFileUpload } = require('./chat.upload');
const {
  requireAppAuth,
  requireAppUser,
} = require('../../common/middleware/requireAppAuth');

/**
 * Chat routes — Phase M1 REST + M2 uploads + M3 Socket.IO (see chat.socket.js).
 */
const chatRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

chatRouter.get(
  '/conversations',
  ...requireActiveAppUser,
  chatController.listConversations,
);
chatRouter.post(
  '/conversations',
  ...requireActiveAppUser,
  chatController.createConversation,
);
chatRouter.post(
  '/conversations/group',
  ...requireActiveAppUser,
  chatController.createGroupConversation,
);
chatRouter.get(
  '/unread-count',
  ...requireActiveAppUser,
  chatController.unreadCount,
);
chatRouter.get(
  '/search',
  ...requireActiveAppUser,
  chatController.searchMessages,
);
chatRouter.post(
  '/uploads',
  ...requireActiveAppUser,
  chatFileUpload,
  chatController.uploadAttachment,
);
chatRouter.get(
  '/conversations/:id',
  ...requireActiveAppUser,
  chatController.getConversation,
);
chatRouter.get(
  '/conversations/:id/messages',
  ...requireActiveAppUser,
  chatController.listMessages,
);
chatRouter.post(
  '/conversations/:id/messages',
  ...requireActiveAppUser,
  chatController.sendMessage,
);
chatRouter.patch(
  '/conversations/:id/messages/:messageId',
  ...requireActiveAppUser,
  chatController.editMessage,
);
chatRouter.delete(
  '/conversations/:id/messages/:messageId',
  ...requireActiveAppUser,
  chatController.deleteMessage,
);
chatRouter.post(
  '/conversations/:id/read',
  ...requireActiveAppUser,
  chatController.markRead,
);
chatRouter.post(
  '/conversations/:id/report-block',
  ...requireActiveAppUser,
  chatController.reportAndBlock,
);
chatRouter.patch(
  '/conversations/:id',
  ...requireActiveAppUser,
  chatController.patchConversation,
);
chatRouter.delete(
  '/conversations/:id',
  ...requireActiveAppUser,
  chatController.deleteConversation,
);

module.exports = { chatRouter };
