'use strict';

/**
 * Shared Socket.IO handle for chat emits from services.
 */

/** @type {import('socket.io').Server | null} */
let io = null;

/**
 * @param {import('socket.io').Server} server
 */
function setChatIo(server) {
  io = server;
}

/**
 * @returns {import('socket.io').Server | null}
 */
function getChatIo() {
  return io;
}

/**
 * Emit an event to a user's private room.
 * @param {string} userId
 * @param {string} event
 * @param {unknown} payload
 */
function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
}

/**
 * Emit to everyone currently in a conversation room.
 * @param {string} conversationId
 * @param {string} event
 * @param {unknown} payload
 */
function emitToConversation(conversationId, event, payload) {
  if (!io || !conversationId) return;
  io.to(`conversation:${String(conversationId)}`).emit(event, payload);
}

/**
 * Emit to a conversation room except one socket user (typing fan-out).
 * Prefer per-user emits when excluding; this broadcasts then clients ignore self.
 * @param {string} conversationId
 * @param {string} event
 * @param {unknown} payload
 */
function emitToConversationRoom(conversationId, event, payload) {
  emitToConversation(conversationId, event, payload);
}

module.exports = {
  setChatIo,
  getChatIo,
  emitToUser,
  emitToConversation,
  emitToConversationRoom,
};
