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
  jwt: Object.freeze({
    // * Dev default is intentional for local start — replace in production.
    secret: required(
      'JWT_SECRET',
      'dev-only-change-me-ssbpsychbigb-jwt-secret',
    ),
    expiresIn: required('JWT_EXPIRES_IN', '7d'),
  }),
  otp: Object.freeze({
    length: Number(required('OTP_LENGTH', '6')),
    ttlSeconds: Number(required('OTP_TTL_SECONDS', '300')),
    /**
     * Return OTP in API responses until an SMS gateway is wired.
     * Set OTP_EXPOSE_IN_RESPONSE=false once real SMS delivery ships.
     */
    exposeInResponse:
      String(process.env.OTP_EXPOSE_IN_RESPONSE ?? 'true').toLowerCase() !==
      'false',
  }),
  upload: Object.freeze({
    dir: required('UPLOAD_DIR', 'uploads'),
    maxFileBytes: Number(required('UPLOAD_MAX_BYTES', String(5 * 1024 * 1024))),
  }),
  features: Object.freeze({
    /**
     * Public Freelancer Educator registration.
     * Set EDUCATOR_FREELANCER_REGISTER=false to hide/disable the join path.
     */
    educatorFreelancerRegister:
      String(process.env.EDUCATOR_FREELANCER_REGISTER ?? 'true').toLowerCase() !==
      'false',
  }),
  email: Object.freeze({
    enabled:
      String(process.env.EMAIL_ENABLED ?? 'false').toLowerCase() === 'true',
    from: String(process.env.EMAIL_FROM ?? '').trim(),
    appPublicUrl: required('APP_PUBLIC_URL', 'http://localhost:5173'),
    smtp: Object.freeze({
      host: String(process.env.SMTP_HOST ?? '').trim(),
      port: Number(process.env.SMTP_PORT ?? '587'),
      secure:
        String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
      user: String(process.env.SMTP_USER ?? '').trim(),
      pass: String(process.env.SMTP_PASS ?? '').trim(),
    }),
  }),
});

module.exports = config;
