'use strict';

const mongoose = require('mongoose');
const { HTTP_STATUS } = require('../../common/constants/httpStatus');
const { AppError } = require('../../common/errors/AppError');

/**
 * Reports process and database readiness for load balancers / ops.
 */
class HealthService {
  /**
   * @returns {{ status: string, uptime: number, timestamp: string, checks: { database: { status: string } } }}
   */
  getStatus() {
    const dbState = mongoose.connection.readyState;
    const databaseHealthy = dbState === 1;

    if (!databaseHealthy) {
      throw new AppError('Service unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        details: {
          database: this.#mapDbState(dbState),
        },
      });
    }

    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: this.#mapDbState(dbState),
        },
      },
    };
  }

  /**
   * @param {number} state
   * @returns {string}
   */
  #mapDbState(state) {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    return states[state] || 'unknown';
  }
}

module.exports = { healthService: new HealthService() };
