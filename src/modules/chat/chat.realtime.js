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

module.exports = {
  setChatIo,
  getChatIo,
  emitToUser,
};
