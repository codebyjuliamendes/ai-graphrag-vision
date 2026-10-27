'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('defaults are safe and documented', () => {
  const c = loadConfig({});
  assert.equal(c.port, 4001);
  assert.equal(c.llmProvider, 'demo');
  assert.equal(c.anthropicModel, 'claude-opus-5-5');
  assert.equal(c.apiToken, null);
  assert.deepEqual(c.corsOrigin, []);
});

test('invalid values are reported together', () => {
  assert.throws(
    () => loadConfig({ PORT: 'abc', LLM_PROVIDER: 'openai', API_TOKEN: 'short' }),
    (err) => /PORT/.test(err.message) && /LLM_PROVIDER/.test(err.message) && /API_TOKEN/.test(err.message),
  );
});

test('lists and empty strings are parsed', () => {
  const c = loadConfig({ CORS_ORIGIN: 'https://a.example, https://b.example', API_TOKEN: '', TRUST_PROXY: '1' });
  assert.deepEqual(c.corsOrigin, ['https://a.example', 'https://b.example']);
  assert.equal(c.apiToken, null);
  assert.equal(c.trustProxy, 1);
});
