'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
function required(key, fallback) {
  const value = process.env[key] ?? fallback;

  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = required('NODE_ENV', 'development');

/**
 * Validated application configuration.
 * Fail fast on startup when required values are missing.
 */
const config = Object.freeze({
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv === 'development',
  port: Number(required('PORT', '5000')),
  apiPrefix: required('API_PREFIX', '/api/v1'),
  mongodbUri: required('MONGODB_URI'),
  corsOrigin: parseList(required('CORS_ORIGIN', 'http://localhost:5173')),
  // * Google + Cloudflare — used only by this Node process for Atlas SRV lookups.
  // * Set DNS_SERVERS= in .env to disable and use the OS resolver.
  dnsServers: parseList(process.env.DNS_SERVERS ?? '8.8.8.8,1.1.1.1'),
});

module.exports = config;
