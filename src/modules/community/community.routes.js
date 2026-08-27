'use strict';

const { Router } = require('express');
const { communityController } = require('./community.controller');
const {
  communityResourceUpload,
} = require('./community-resource.upload');
const {
  requireAppAuth,
  requireAppUser,
  optionalAppAuth,
} = require('../../common/middleware/requireAppAuth');
const { createRateLimiter } = require('../../common/middleware/rateLimit');

/**
 * Community routes — Module 5 + W4 depth.
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
communityRouter.get('/:slug/members', optionalAppAuth, communityController.listMembers);
communityRouter.post('/:slug/invite', ...requireActiveAppUser, communityController.invite);
communityRouter.delete(
  '/:slug/members/:userId',
  ...requireActiveAppUser,
  communityController.kickMember,
);
communityRouter.patch(
  '/:slug/members/:userId/mute',
  ...requireActiveAppUser,
  communityController.muteMember,
);
communityRouter.patch(
  '/:slug/members/:userId/role',
  ...requireActiveAppUser,
  communityController.setMemberRole,
);
communityRouter.delete(
  '/:slug/posts/:postId',
  ...requireActiveAppUser,
  communityController.removePost,
);
communityRouter.post(
  '/:slug/posts/:postId/pin',
  ...requireActiveAppUser,
  communityController.pinPost,
);
communityRouter.delete(
  '/:slug/posts/:postId/pin',
  ...requireActiveAppUser,
  (req, res, next) => {
    req.body = { ...(req.body || {}), pinned: false };
    return communityController.pinPost(req, res, next);
  },
);
communityRouter.get('/:slug/feed', optionalAppAuth, communityController.feed);
communityRouter.post(
  '/:slug/announcements',
  ...requireActiveAppUser,
  communityController.announce,
);

communityRouter.get(
  '/:slug/resources',
  optionalAppAuth,
  communityController.listResources,
);
communityRouter.post(
  '/:slug/resources/upload',
  ...requireActiveAppUser,
  communityResourceUpload,
  communityController.uploadResourceFile,
);
communityRouter.post(
  '/:slug/resources',
  ...requireActiveAppUser,
  communityController.createResource,
);
communityRouter.post(
  '/:slug/resources/:resourceId/pin',
  ...requireActiveAppUser,
  communityController.pinResource,
);
communityRouter.delete(
  '/:slug/resources/:resourceId/pin',
  ...requireActiveAppUser,
  (req, res, next) => {
    req.body = { ...(req.body || {}), pinned: false };
    return communityController.pinResource(req, res, next);
  },
);
communityRouter.delete(
  '/:slug/resources/:resourceId',
  ...requireActiveAppUser,
  communityController.deleteResource,
);

communityRouter.get(
  '/:slug/events',
  optionalAppAuth,
  communityController.listEvents,
);
communityRouter.post(
  '/:slug/events',
  ...requireActiveAppUser,
  communityController.createEvent,
);
communityRouter.delete(
  '/:slug/events/:eventId',
  ...requireActiveAppUser,
  communityController.cancelEvent,
);
communityRouter.post(
  '/:slug/events/:eventId/rsvp',
  ...requireActiveAppUser,
  communityController.setEventRsvp,
);
communityRouter.delete(
  '/:slug/events/:eventId/rsvp',
  ...requireActiveAppUser,
  communityController.clearEventRsvp,
);

communityRouter.get(
  '/:slug/analytics',
  ...requireActiveAppUser,
  communityController.analytics,
);

module.exports = { communityRouter };
