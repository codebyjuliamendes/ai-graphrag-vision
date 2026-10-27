'use strict';

const pino = require('pino');

/**
 * Structured JSON logger. Secrets that could appear in request logs are redacted.
 * @param {{ logLevel: string }} config
 */
function createLogger({ logLevel }) {
  return pino({
    level: logLevel,
    base: { service: 'ai-graphrag-vision' },
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
  });
}

module.exports = { createLogger };
