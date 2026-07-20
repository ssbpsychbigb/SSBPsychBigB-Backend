'use strict';

const dns = require('dns');
const mongoose = require('mongoose');
const config = require('./index');
const { logger } = require('../common/utils/logger');

/**
 * * Forces public DNS for this Node process only.
 * Avoids ISP/resolver failures on mongodb+srv SRV lookups (querySrv ECONNREFUSED)
 * without changing Windows DNS for other apps.
 */
function configureDnsServers() {
  if (!config.dnsServers.length) {
    return;
  }

  dns.setServers(config.dnsServers);
  logger.info('Node DNS servers configured', { servers: config.dnsServers });
}

/**
 * Establishes a shared Mongoose connection for the process lifetime.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDatabase() {
  configureDnsServers();

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { message: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: 10_000,
  });

  return mongoose;
}

/**
 * Closes the Mongoose connection gracefully.
 * @returns {Promise<void>}
 */
async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
