'use strict';

const { Router } = require('express');
const { healthRouter } = require('../modules');

/**
 * Versioned API router. New domain modules are mounted here.
 */
const apiRouter = Router();

apiRouter.use('/health', healthRouter);

// * Example when adding auth later:
// * apiRouter.use('/auth', authRouter);
// * apiRouter.use('/users', userRouter);

module.exports = { apiRouter };
