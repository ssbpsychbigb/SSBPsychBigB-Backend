'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { apiRouter } = require('./routes');
const { requestLogger } = require('./common/middleware/requestLogger');
const { notFoundHandler } = require('./common/middleware/notFoundHandler');
const { errorHandler } = require('./common/middleware/errorHandler');

/**
 * Builds and configures the Express application (no listen / no DB).
 * Kept separate from server bootstrap so tests can import the app cleanly.
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'SSBPsychBigB API',
      data: {
        version: '1.0.0',
        docs: config.apiPrefix,
      },
    });
  });

  app.use(config.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
