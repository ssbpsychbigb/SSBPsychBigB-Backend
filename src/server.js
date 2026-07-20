'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { logger } = require('./common/utils/logger');

let server;

/**
 * Boots database + HTTP server and registers graceful shutdown hooks.
 */
async function bootstrap() {
  await connectDatabase();

  const app = createApp();

  server = app.listen(config.port, () => {
    logger.info('API server started', {
      env: config.env,
      port: config.port,
      apiPrefix: config.apiPrefix,
    });
  });
}

/**
 * Stops accepting traffic, closes DB, then exits.
 * @param {string} signal
 */
async function shutdown(signal) {
  logger.info('Shutdown signal received', { signal });

  const forceExitTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  forceExitTimer.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    await disconnectDatabase();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { message: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  void shutdown('uncaughtException');
});

bootstrap().catch((err) => {
  logger.error('Failed to start server', { message: err.message, stack: err.stack });
  process.exit(1);
});
