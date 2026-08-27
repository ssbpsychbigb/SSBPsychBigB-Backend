'use strict';

const { dayBriefService } = require('./day-brief.service');
const { logger } = require('../../common/utils/logger');

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly purge of expired Day Briefs + views.
 * @returns {() => void} stop function
 */
function startDayBriefPurgeJob() {
  const run = () => {
    void dayBriefService
      .purgeExpired({ soft: false })
      .catch((error) => {
        logger.error('Day Brief purge failed', { message: error?.message });
      });
  };

  run();
  const timer = setInterval(run, PURGE_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

module.exports = { startDayBriefPurgeJob };
