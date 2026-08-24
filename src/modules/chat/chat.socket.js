'use strict';

const { Server } = require('socket.io');
const mongoose = require('mongoose');
const config = require('../../config');
const { verifyAccessToken } = require('../../common/utils/jwt');
const { PORTAL } = require('../auth/auth.constants');
const { logger } = require('../../common/utils/logger');
const { ChatMembership } = require('./chat.model');
const { ChatConversation } = require('./chat.model');
const presence = require('./chat.presence');
const { setChatIo, emitToUser } = require('./chat.realtime');

/**
 * Resolve peer user ids for presence fan-out (cap for lightness).
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function peerIdsForUser(userId) {
  const memberships = await ChatMembership.find({
    userId: new mongoose.Types.ObjectId(userId),
    deletedForUserAt: null,
  })
    .select('conversationId')
    .limit(80)
    .lean();

  if (memberships.length === 0) return [];

  const conversations = await ChatConversation.find({
    _id: { $in: memberships.map((m) => m.conversationId) },
  })
    .select('participantIds')
    .lean();

  const peers = new Set();
  const self = String(userId);
  for (const conversation of conversations) {
    for (const id of conversation.participantIds || []) {
      const peer = String(id);
      if (peer !== self) peers.add(peer);
    }
  }
  return [...peers];
}

/**
 * Attach Socket.IO to the HTTP server for chat realtime.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function attachChatSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
  });

  setChatIo(io);

  io.use((socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        '';
      const token = String(raw)
        .replace(/^Bearer\s+/i, '')
        .trim();

      if (!token) {
        next(new Error('Authentication required'));
        return;
      }

      const payload = verifyAccessToken(token);
      if (payload.portal && payload.portal !== PORTAL.APP) {
        next(new Error('Wrong portal'));
        return;
      }
      if (!payload.sub) {
        next(new Error('Invalid token'));
        return;
      }

      socket.userId = String(payload.sub);
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);

    const count = presence.connect(userId);
    if (count === 1) {
      void peerIdsForUser(userId)
        .then((peers) => {
          for (const peerId of peers) {
            emitToUser(peerId, 'presence:update', {
              userId,
              online: true,
            });
          }
        })
        .catch((err) => {
          logger.warn('Presence fan-out failed', { message: err.message });
        });
    }

    socket.on('conversation:join', (payload) => {
      const conversationId = String(payload?.conversationId || '');
      if (!mongoose.Types.ObjectId.isValid(conversationId)) return;
      void ChatMembership.findOne({
        conversationId,
        userId,
        deletedForUserAt: null,
      })
        .then((membership) => {
          if (membership) {
            socket.join(`conversation:${conversationId}`);
          }
        })
        .catch(() => {});
    });

    socket.on('conversation:leave', (payload) => {
      const conversationId = String(payload?.conversationId || '');
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
    });

    socket.on('presence:ping', (payload) => {
      const ids = Array.isArray(payload?.userIds) ? payload.userIds : [];
      const cleaned = ids.map(String).filter(Boolean).slice(0, 50);
      socket.emit('presence:snapshot', {
        online: presence.snapshot(cleaned),
      });
    });

    socket.on('disconnect', () => {
      const remaining = presence.disconnect(userId);
      if (remaining === 0) {
        void peerIdsForUser(userId)
          .then((peers) => {
            for (const peerId of peers) {
              emitToUser(peerId, 'presence:update', {
                userId,
                online: false,
              });
            }
          })
          .catch(() => {});
      }
    });

    logger.info('Chat socket connected', { userId });
  });

  return io;
}

module.exports = { attachChatSocket };
