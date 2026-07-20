'use strict';

/**
 * Lightweight structured logger.
 * Swap the transport later (e.g. pino/winston) without changing call sites.
 */
const LEVELS = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

/**
 * @param {string} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function write(level, message, meta = {}) {
  if ((LEVELS[level] ?? 99) > currentLevel) {
    return;
  }

  const entry = {
    level,
    timestamp: new Date().toISOString(),
    ...meta,
    // * Keep the primary message authoritative even if meta includes `message`.
    message,
  };

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};

module.exports = { logger };
