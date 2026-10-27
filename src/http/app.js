'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet').default;
const cors = require('cors');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const pinoHttp = require('pino-http').default;
const { requestSchemas } = require('../domain/schemas');
const { AppError } = require('../errors');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SAMPLE_FILE = path.join(ROOT, 'samples', 'q3-financial-report.md');
const SAMPLE_TITLE = 'Q3 Financial Report (fictional sample)';

/**
 * @typedef {import('../config').AppConfig} AppConfig
 * @typedef {ReturnType<typeof import('../services/graphRagService').createGraphRagService>} GraphRagService
 */

/**
 * @param {import('zod').ZodType} schema
 * @param {unknown} body
 */
function validate(schema, body) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(' ');
    throw new AppError(400, 'VALIDATION_ERROR', message, { details: parsed.error.issues });
  }
  return parsed.data;
}

/**
 * Constant-time bearer-token check (hashing equalizes lengths).
 * @param {string | null} token
 */
function requireToken(token) {
  /** @type {express.RequestHandler} */
  return (req, _res, next) => {
    if (!token) return next();
    const header = req.get('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(token).digest();
    if (!given || !crypto.timingSafeEqual(a, b)) {
      return next(new AppError(401, 'UNAUTHORIZED', 'A valid API token is required for this operation.'));
    }
    return next();
  };
}

/**
 * Builds the Express application. Pure wiring: no listening, no process handlers.
 * @param {{ config: AppConfig, service: GraphRagService, logger: import('pino').Logger }} deps
 */
function createApp({ config, service, logger }) {
  const app = express();
  const schemas = requestSchemas({ maxDocumentChars: config.maxDocumentChars });

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  if (config.corsOrigin.length > 0) app.use('/api', cors({ origin: config.corsOrigin }));
  app.use(compression());
  app.use(express.json({ limit: Math.ceil(config.maxDocumentChars * 4 + 16_384) }));

  const limiter = (/** @type {number} */ limit) =>
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again later.')),
    });
  const writeLimiter = limiter(config.rateLimitWrites);
  const queryLimiter = limiter(config.rateLimitQueries);
  const auth = requireToken(config.apiToken);

  // --- Operational endpoints -------------------------------------------------
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', (_req, res) => {
    const ready = service.isReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'starting' });
  });

  // --- API -------------------------------------------------------------------
  app.get('/api/status', (_req, res) => {
    res.json({
      success: true,
      data: {
        provider: service.provider.name,
        demo: service.provider.demo,
        model: service.provider.demo ? null : config.anthropicModel,
        authRequired: Boolean(config.apiToken),
        limits: { maxDocumentChars: config.maxDocumentChars },
        stats: service.getGraph().stats,
      },
    });
  });

  app.get('/api/graph', (_req, res) => {
    res.json({ success: true, graph: service.getGraph() });
  });

  app.get('/api/documents', (_req, res) => {
    res.json({ success: true, documents: service.listDocuments() });
  });

  app.post('/api/documents', writeLimiter, auth, async (req, res) => {
    const input = validate(schemas.document, req.body);
    const result = await service.ingestDocument(input);
    res.status(result.created ? 201 : 200).json({ success: true, ...result, graph: service.getGraph() });
  });

  app.delete('/api/documents/:id', writeLimiter, auth, async (req, res) => {
    await service.deleteDocument(String(req.params.id));
    res.json({ success: true, graph: service.getGraph() });
  });

  /** Backwards-compatible endpoint: indexes the bundled fictional sample report. */
  app.post('/api/process-document', writeLimiter, auth, async (_req, res) => {
    const text = await fs.readFile(SAMPLE_FILE, 'utf8');
    const result = await service.ingestDocument({ title: SAMPLE_TITLE, text });
    res.json({ success: true, ...result, graph: service.getGraph() });
  });

  app.post('/api/query', queryLimiter, async (req, res) => {
    const { query } = validate(schemas.query, req.body);
    const data = await service.query(query);
    res.json({ success: true, data });
  });

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));

  // --- Static assets ---------------------------------------------------------
  app.get('/api-docs', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'api-docs.html')));
  app.use(
    '/vendor/cytoscape',
    express.static(path.dirname(require.resolve('cytoscape/dist/cytoscape.min.js')), { maxAge: '7d' }),
  );
  app.use(
    '/vendor/swagger-ui',
    express.static(path.dirname(require.resolve('swagger-ui-dist/package.json')), { maxAge: '7d', index: false }),
  );
  app.use(express.static(PUBLIC_DIR, { maxAge: config.env === 'production' ? '1h' : 0 }));

  // --- Errors ----------------------------------------------------------------
  /** @type {express.ErrorRequestHandler} */
  const errorHandler = (err, req, res, _next) => {
    /** @type {AppError} */
    let error;
    if (err instanceof AppError) error = err;
    else if (err?.type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', 'Malformed JSON body.');
    else if (err?.type === 'entity.too.large')
      error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    else error = new AppError(500, 'INTERNAL_ERROR', 'Internal Server Error', { cause: err });

    if (error.status >= 500) req.log.error({ err, code: error.code }, error.message);
    else req.log.warn({ code: error.code, status: error.status }, error.message);

    if (res.headersSent) return;
    res.status(error.status).json({ success: false, error: error.message, code: error.code });
  };
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, SAMPLE_TITLE };
