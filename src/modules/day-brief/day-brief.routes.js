'use strict';

const { Router } = require('express');
const { dayBriefController } = require('./day-brief.controller');
const { dayBriefMediaUpload } = require('./day-brief.upload');
const {
  requireAppAuth,
  requireAppUser,
} = require('../../common/middleware/requireAppAuth');
const { createRateLimiter } = require('../../common/middleware/rateLimit');

/**
 * Day Brief routes — 24h Home strip stories.
 *
 * GET    /day-briefs
 * POST   /day-briefs/media
 * POST   /day-briefs
 * POST   /day-briefs/:id/view
 * DELETE /day-briefs/:id
 */
const dayBriefRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

const limitCreate = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: 'daybrief:create',
  message: 'Sharing Day Briefs too fast. Please wait a few minutes.',
});

const limitMedia = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyPrefix: 'daybrief:media',
  message: 'Too many uploads. Please wait a few minutes.',
});

dayBriefRouter.get('/', ...requireActiveAppUser, dayBriefController.list);

dayBriefRouter.post(
  '/media',
  ...requireActiveAppUser,
  limitMedia,
  dayBriefMediaUpload,
  dayBriefController.upload,
);

dayBriefRouter.post(
  '/',
  ...requireActiveAppUser,
  limitCreate,
  dayBriefController.create,
);

dayBriefRouter.post(
  '/:id/view',
  ...requireActiveAppUser,
  dayBriefController.markViewed,
);

dayBriefRouter.delete('/:id', ...requireActiveAppUser, dayBriefController.remove);

module.exports = { dayBriefRouter };
