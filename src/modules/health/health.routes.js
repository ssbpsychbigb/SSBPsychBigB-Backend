'use strict';

const { Router } = require('express');
const { healthController } = require('./health.controller');

const healthRouter = Router();

healthRouter.get('/', healthController.getHealth);

module.exports = { healthRouter };
