'use strict';

const { Router } = require('express');
const { instituteTeamController } = require('./institute-team.controller');
const {
  requireAppAuth,
  requireAppUser,
} = require('../../common/middleware/requireAppAuth');
const {
  APP_ROLES,
} = require('../auth/auth.constants');
const { teamProfileUpload } = require('../auth/auth.upload');
const {
  hydrateInstituteActorContext,
} = require('./institute-team.service');

/**
 * Institute team routes (app portal).
 *
 * GET    /institute/team/catalog
 * GET    /institute/team
 * POST   /institute/team
 * PATCH  /institute/team/:memberId
 * DELETE /institute/team/:memberId
 */
const instituteTeamRouter = Router();

instituteTeamRouter.use(requireAppAuth);
instituteTeamRouter.use(
  requireAppUser({
    requireActive: true,
    roles: [
      APP_ROLES.INSTITUTE,
      APP_ROLES.INSTITUTE_ADMIN,
      APP_ROLES.EDUCATOR,
      APP_ROLES.USER,
      APP_ROLES.ASPIRANT,
    ],
  }),
);
instituteTeamRouter.use(async (req, _res, next) => {
  try {
    await hydrateInstituteActorContext(req.appUser);
    return next();
  } catch (error) {
    return next(error);
  }
});

instituteTeamRouter.get('/catalog', instituteTeamController.catalog);
instituteTeamRouter.get('/roles', instituteTeamController.listRoles);
instituteTeamRouter.post('/roles', instituteTeamController.createRole);
instituteTeamRouter.patch(
  '/roles/:roleId',
  instituteTeamController.updateRole,
);
instituteTeamRouter.delete(
  '/roles/:roleId',
  instituteTeamController.deleteRole,
);
instituteTeamRouter.get('/code', instituteTeamController.instituteCode);
instituteTeamRouter.get(
  '/freelancers',
  instituteTeamController.searchFreelancers,
);
instituteTeamRouter.get('/', instituteTeamController.list);
instituteTeamRouter.post(
  '/',
  teamProfileUpload,
  instituteTeamController.invite,
);
instituteTeamRouter.post('/hire', instituteTeamController.hireFreelancer);
instituteTeamRouter.post(
  '/profiles/:profileId/accept',
  instituteTeamController.acceptJoin,
);
instituteTeamRouter.post(
  '/profiles/:profileId/reject',
  instituteTeamController.rejectJoin,
);
instituteTeamRouter.post(
  '/profiles/:profileId/leave/decide',
  instituteTeamController.decideLeave,
);
instituteTeamRouter.post(
  '/profiles/:profileId/resign/decide',
  instituteTeamController.decideResign,
);
instituteTeamRouter.post(
  '/profiles/:profileId/fire',
  instituteTeamController.fireMember,
);
instituteTeamRouter.post(
  '/profiles/:profileId/release',
  instituteTeamController.releaseNotice,
);
instituteTeamRouter.patch(
  '/:memberId',
  teamProfileUpload,
  instituteTeamController.update,
);
instituteTeamRouter.delete('/:memberId', instituteTeamController.remove);

module.exports = { instituteTeamRouter };
