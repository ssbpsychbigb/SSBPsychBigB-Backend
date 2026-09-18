'use strict';

const { processDueBroadcasts } = require('./scheduled-broadcast.service');
const { logger } = require('../../common/utils/logger');

const INTERVAL_MS = 60 * 1000;

/**
 * Every minute: send pending scheduled broadcasts that are due (NOTIF-S07).
 * @returns {() => void} stop function
 */
function startScheduledBroadcastJob() {
  const run = () => {
    void processDueBroadcasts().catch((error) => {
      logger.error('Scheduled broadcast job failed', {
        message: error?.message,
      });
    });
  };

  run();
  const timer = setInterval(run, INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

module.exports = { startScheduledBroadcastJob };
