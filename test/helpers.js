'use strict';

const pino = require('pino');
const { loadConfig } = require('../src/config');
const { createDemoProvider } = require('../src/providers/demoProvider');
const { createMemoryStore } = require('../src/storage/graphStore');
const { createGraphRagService } = require('../src/services/graphRagService');
const { createApp } = require('../src/http/app');

/**
 * @param {{ env?: Record<string, string>, provider?: any, store?: any }} [options]
 */
async function buildApp(options = {}) {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATA_DIR: '/nonexistent', ...options.env });
  const service = createGraphRagService({
    store: options.store ?? createMemoryStore(),
    provider: options.provider ?? createDemoProvider(),
    options: {
      chunkSize: config.chunkSize,
      topK: config.topK,
      maxContextChars: config.maxContextChars,
      extractionConcurrency: config.extractionConcurrency,
    },
  });
  await service.init();
  const app = createApp({ config, service, logger: pino({ level: 'silent' }) });
  return { app, service, config };
}

module.exports = { buildApp };
