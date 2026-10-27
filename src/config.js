'use strict';

const path = require('node:path');
const { z } = require('zod');

const int = (/** @type {number} */ def, /** @type {number} */ min, /** @type {number} */ max) =>
  z.coerce.number().int().min(min).max(max).default(def);

const emptyToUndefined = (/** @type {unknown} */ v) => (v === '' ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(4001, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10).default(0)),
  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().optional()),
  API_TOKEN: z.preprocess(
    emptyToUndefined,
    z.string().min(16, 'API_TOKEN must have at least 16 characters').optional(),
  ),

  LLM_PROVIDER: z.enum(['demo', 'anthropic']).default('demo'),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
  LLM_TIMEOUT_MS: int(120_000, 1_000, 600_000),

  DATA_DIR: z.string().default(path.join(process.cwd(), 'data')),
  MAX_DOCUMENT_CHARS: int(200_000, 1_000, 2_000_000),
  CHUNK_SIZE: int(1200, 200, 8000),
  RETRIEVAL_TOP_K: int(6, 1, 30),
  MAX_CONTEXT_CHARS: int(12_000, 1_000, 200_000),
  EXTRACTION_CONCURRENCY: int(3, 1, 16),

  RATE_LIMIT_WINDOW_MS: int(60_000, 1_000, 3_600_000),
  RATE_LIMIT_WRITES: int(10, 1, 10_000),
  RATE_LIMIT_QUERIES: int(60, 1, 10_000),
  SHUTDOWN_TIMEOUT_MS: int(10_000, 1_000, 120_000),
});

/**
 * @typedef {ReturnType<typeof loadConfig>} AppConfig
 */

/**
 * Validates environment variables once at boot; throws with every problem listed.
 * @param {NodeJS.ProcessEnv} [env]
 */
function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    corsOrigin: e.CORS_ORIGIN
      ? e.CORS_ORIGIN.split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [],
    apiToken: e.API_TOKEN ?? null,
    llmProvider: e.LLM_PROVIDER,
    anthropicModel: e.ANTHROPIC_MODEL,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    dataFile: path.resolve(e.DATA_DIR, 'graph.json'),
    maxDocumentChars: e.MAX_DOCUMENT_CHARS,
    chunkSize: e.CHUNK_SIZE,
    topK: e.RETRIEVAL_TOP_K,
    maxContextChars: e.MAX_CONTEXT_CHARS,
    extractionConcurrency: e.EXTRACTION_CONCURRENCY,
    rateLimitWindowMs: e.RATE_LIMIT_WINDOW_MS,
    rateLimitWrites: e.RATE_LIMIT_WRITES,
    rateLimitQueries: e.RATE_LIMIT_QUERIES,
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
  };
}

module.exports = { loadConfig };
