'use strict';

const { Router } = require('express');
const { profileController } = require('./profile.controller');
const {
  requireAppAuth,
  requireAppUser,
  optionalAppAuth,
} = require('../../common/middleware/requireAppAuth');

/**
 * Profile routes — Module 3 Phase A.
 */
const profileRouter = Router();

const requireActiveAppUser = [
  requireAppAuth,
  requireAppUser({ requireActive: true }),
];

profileRouter.get('/me', ...requireActiveAppUser, profileController.getMe);
profileRouter.patch('/me', ...requireActiveAppUser, profileController.updateMe);
profileRouter.post(
  '/me/photo',
  ...requireActiveAppUser,
  profileController.uploadPhoto,
);
profileRouter.post(
  '/me/banner',
  ...requireActiveAppUser,
  profileController.uploadBanner,
);

profileRouter.post(
  '/me/timeline',
  ...requireActiveAppUser,
  profileController.addTimeline,
);
profileRouter.delete(
  '/me/timeline/:eventId',
  ...requireActiveAppUser,
  profileController.removeTimeline,
);
profileRouter.post(
  '/me/achievements',
  ...requireActiveAppUser,
  profileController.addAchievement,
);
profileRouter.delete(
  '/me/achievements/:achievementId',
  ...requireActiveAppUser,
  profileController.removeAchievement,
);

profileRouter.get(
  '/me/network-overview',
  ...requireActiveAppUser,
  profileController.getNetworkOverview,
);
profileRouter.get(
  '/me/network-insights',
  ...requireActiveAppUser,
  profileController.getNetworkInsights,
);
profileRouter.get(
  '/me/suggestions',
  optionalAppAuth,
  profileController.listSuggestions,
);

profileRouter.get(
  '/:username/posts',
  optionalAppAuth,
  profileController.listPosts,
);
profileRouter.get(
  '/:username/network',
  optionalAppAuth,
  profileController.listNetwork,
);
profileRouter.get(
  '/:username/timeline',
  optionalAppAuth,
  profileController.listTimeline,
);
profileRouter.get(
  '/:username/achievements',
  optionalAppAuth,
  profileController.listAchievements,
);
profileRouter.get(
  '/:username',
  optionalAppAuth,
  profileController.getByUsername,
);

module.exports = { profileRouter };
