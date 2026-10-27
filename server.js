'use strict';

/**
 * Process entry point: config -> logger -> provider/store/service -> HTTP server,
 * plus graceful shutdown on SIGTERM/SIGINT.
 */

const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createProvider } = require('./src/providers');
const { createJsonFileStore } = require('./src/storage/graphStore');
const { createGraphRagService } = require('./src/services/graphRagService');
const { createApp } = require('./src/http/app');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const provider = createProvider(config);
  const store = createJsonFileStore(config.dataFile);
  const service = createGraphRagService({
    store,
    provider,
    options: {
      chunkSize: config.chunkSize,
      topK: config.topK,
      maxContextChars: config.maxContextChars,
      extractionConcurrency: config.extractionConcurrency,
    },
  });
  await service.init();

  if (provider.demo) {
    logger.warn('LLM_PROVIDER=demo: running the offline rule-based demo provider (no language model is used).');
  } else if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    logger.warn('LLM_PROVIDER=anthropic without ANTHROPIC_API_KEY: relying on other SDK credential sources.');
  }

  const app = createApp({ config, service, logger });
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      { port: config.port, provider: provider.name, store: store.describe() },
      `GraphRAG Vision listening on http://${config.host}:${config.port}`,
    );
  });
  server.requestTimeout = config.llmTimeoutMs + 30_000;

  let shuttingDown = false;
  const shutdown = (/** @type {string} */ signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const timer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timer.unref();
    server.close((err) => {
      if (err) logger.error({ err }, 'Error while closing the HTTP server');
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'Failed to start', error: String(error?.message ?? error) }));
  process.exit(1);
});
