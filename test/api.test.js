'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

test('health and readiness probes', async () => {
  const { app } = await buildApp();
  await request(app).get('/healthz').expect(200, { status: 'ok' });
  await request(app).get('/readyz').expect(200, { status: 'ready' });
});

test('security headers and CSP are set; x-powered-by is not', async () => {
  const { app } = await buildApp();
  const res = await request(app).get('/').expect(200);
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.ok(res.headers['x-request-id']);
  await request(app).get('/vendor/cytoscape/cytoscape.min.js').expect(200);
  await request(app).get('/api-docs').expect(200).expect('content-type', /html/);
  await request(app).get('/swagger.json').expect(200);
});

test('legacy /api/process-document indexes the sample and is idempotent', async () => {
  const { app } = await buildApp();
  const first = await request(app).post('/api/process-document').expect(200);
  assert.equal(first.body.success, true);
  assert.equal(first.body.created, true);
  assert.ok(first.body.graph.nodes.length >= 8);
  assert.ok(first.body.graph.edges.some((e) => e.data.label === 'ACQUIRED'));
  const second = await request(app).post('/api/process-document').expect(200);
  assert.equal(second.body.created, false);
});

test('query validates input', async () => {
  const { app } = await buildApp();
  for (const body of [{}, { query: '' }, { query: '   ' }, { query: 42 }, { query: 'x'.repeat(2001) }]) {
    const res = await request(app).post('/api/query').send(body).expect(400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.match(res.body.error, /query/);
  }
  const noBody = await request(app).post('/api/query').expect(400);
  assert.equal(noBody.body.code, 'VALIDATION_ERROR');
  const bad = await request(app)
    .post('/api/query')
    .set('content-type', 'application/json')
    .send('{"query":')
    .expect(400);
  assert.equal(bad.body.code, 'INVALID_JSON');
});

test('query answers from the graph with citations (demo provider)', async () => {
  const { app } = await buildApp();
  await request(app).post('/api/process-document').expect(200);
  const res = await request(app).post('/api/query').send({ query: 'Who acquired OmniTech and when?' }).expect(200);
  const { data } = res.body;
  assert.equal(data.demo, true);
  assert.equal(data.provider, 'demo');
  assert.match(data.answer, /NexCorp acquired OmniTech/);
  assert.match(data.answer, /\[\d+\]/);
  assert.ok(data.citations.length >= 1);
  assert.equal(data.citations[0].documentTitle, 'Q3 Financial Report (fictional sample)');
  assert.ok(data.highlightedNodes.includes('omnitech'));
  assert.ok(data.highlightedNodes.includes('nexcorp'));
});

test('documents can be created, listed and deleted', async () => {
  const { app } = await buildApp();
  const text = 'AcmeCorp partnered with Globex Labs in 2022. Globex Labs is based in Porto.';
  const created = await request(app).post('/api/documents').send({ title: 'Memo', text }).expect(201);
  assert.equal(created.body.document.title, 'Memo');
  await request(app).post('/api/documents').send({ title: 'Memo', text }).expect(200);
  const list = await request(app).get('/api/documents').expect(200);
  assert.equal(list.body.documents.length, 1);
  const graph = await request(app).get('/api/graph').expect(200);
  assert.ok(graph.body.graph.nodes.some((n) => n.data.id === 'globex-labs'));
  await request(app).delete(`/api/documents/${created.body.document.id}`).expect(200);
  await request(app).delete(`/api/documents/${created.body.document.id}`).expect(404);
  const res = await request(app).post('/api/documents').send({ title: '', text: 'short' }).expect(400);
  assert.match(res.body.error, /title is required/);
});

test('document size is bounded', async () => {
  const { app } = await buildApp({ env: { MAX_DOCUMENT_CHARS: '1000' } });
  const res = await request(app)
    .post('/api/documents')
    .send({ title: 't', text: 'a'.repeat(1001) })
    .expect(400);
  assert.match(res.body.error, /at most 1000/);
});

test('write endpoints require the API token when configured', async () => {
  const token = 'a-very-long-test-token';
  const { app } = await buildApp({ env: { API_TOKEN: token } });
  const status = await request(app).get('/api/status').expect(200);
  assert.equal(status.body.data.authRequired, true);
  await request(app).post('/api/process-document').expect(401);
  await request(app).post('/api/process-document').set('authorization', 'Bearer wrong').expect(401);
  await request(app).post('/api/process-document').set('authorization', `Bearer ${token}`).expect(200);
  // Reads stay public.
  await request(app).post('/api/query').send({ query: 'NexCorp' }).expect(200);
});

test('write endpoints are rate limited', async () => {
  const { app } = await buildApp({ env: { RATE_LIMIT_WRITES: '2' } });
  await request(app).post('/api/process-document').expect(200);
  await request(app).post('/api/process-document').expect(200);
  const res = await request(app).post('/api/process-document').expect(429);
  assert.equal(res.body.code, 'RATE_LIMITED');
});

test('unknown API routes return JSON 404 and errors do not leak internals', async () => {
  const failing = {
    name: 'broken',
    demo: false,
    async extract() {
      throw new Error('secret internal detail');
    },
    async answer() {
      return { answer: 'x', citedSources: [] };
    },
  };
  const { app } = await buildApp({ provider: failing });
  const nf = await request(app).get('/api/nope').expect(404);
  assert.equal(nf.body.code, 'NOT_FOUND');
  const res = await request(app).post('/api/process-document').expect(500);
  assert.equal(res.body.error, 'Internal Server Error');
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('CORS is off by default and allow-listed when configured', async () => {
  const off = await buildApp();
  const a = await request(off.app).get('/api/status').set('origin', 'https://evil.example');
  assert.equal(a.headers['access-control-allow-origin'], undefined);
  const on = await buildApp({ env: { CORS_ORIGIN: 'https://app.example' } });
  const b = await request(on.app).get('/api/status').set('origin', 'https://app.example');
  assert.equal(b.headers['access-control-allow-origin'], 'https://app.example');
});
