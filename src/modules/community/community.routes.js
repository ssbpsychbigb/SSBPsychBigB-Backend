'use strict';

const { Router } = require('express');
const { communityController } = require('./community.controller');
const {
  requireAppAuth,
  requireAppUser,
  optionalAppAuth,
} = require('../../common/middleware/requireAppAuth');
const { createRateLimiter } = require('../../common/middleware/rateLimit');

/**
 * Community routes — Module 5 MVP.
 * Mounted at /api/v1/communities
 */
const communityRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

const limitCreate = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'community:create',
  message: 'Too many communities created. Please wait.',
});

communityRouter.get('/', optionalAppAuth, communityController.list);
communityRouter.get('/mine', ...requireActiveAppUser, communityController.listMine);
communityRouter.post(
  '/',
  ...requireActiveAppUser,
  limitCreate,
  communityController.create,
);

communityRouter.get('/:slug', optionalAppAuth, communityController.getBySlug);
communityRouter.post('/:slug/join', ...requireActiveAppUser, communityController.join);
communityRouter.delete('/:slug/leave', ...requireActiveAppUser, communityController.leave);
communityRouter.get('/:slug/feed', optionalAppAuth, communityController.feed);
communityRouter.post(
  '/:slug/announcements',
  ...requireActiveAppUser,
  communityController.announce,
);

module.exports = { communityRouter };
