'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk').default;
const { createDemoProvider, extractHeuristic } = require('../src/providers/demoProvider');
const { createAnthropicProvider } = require('../src/providers/anthropicProvider');
const { extractionSchema } = require('../src/domain/schemas');
const { AppError } = require('../src/errors');

const sample = fs.readFileSync(path.join(__dirname, '..', 'samples', 'q3-financial-report.md'), 'utf8');

test('demo extraction finds the main entities and relations of the sample', () => {
  const result = extractionSchema.parse(extractHeuristic(sample));
  const types = Object.fromEntries(result.entities.map((e) => [e.name, e.type]));
  assert.equal(types.NexCorp, 'company');
  assert.equal(types.OmniTech, 'company');
  assert.equal(types['Jane Doe'], 'person');
  assert.equal(types['Atlas AI Platform'], 'product');
  assert.equal(types.Lisbon, 'location');
  const triples = result.relations.map((r) => `${r.source} ${r.label} ${r.target}`);
  assert.ok(triples.includes('NexCorp ACQUIRED OmniTech'));
  assert.ok(triples.includes('Jane Doe CEO_OF NexCorp'));
  assert.ok(triples.includes('OmniTech DEVELOPED Atlas AI Platform'));
  const acquired = result.relations.find((r) => r.label === 'ACQUIRED');
  assert.equal(acquired?.valid_from, 2023);
});

test('demo answer is extractive and cites sources', async () => {
  const provider = createDemoProvider();
  const out = await provider.answer({
    question: 'Who acquired OmniTech?',
    sources: [
      { n: 1, title: 't', text: 'The sky is blue. NexCorp acquired OmniTech in 2023.' },
      { n: 2, title: 't', text: 'Nothing here.' },
    ],
    facts: [],
  });
  assert.deepEqual(out, { answer: 'NexCorp acquired OmniTech in 2023. [1]', citedSources: [1] });
});

/** Minimal stand-in for the SDK client: records requests, replays canned replies. */
function mockClient(reply) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
}

const textReply = (obj, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text: JSON.stringify(obj) }],
});

test('anthropic provider sends structured-output requests with fallbacks', async () => {
  const client = mockClient(textReply({ entities: [{ name: 'A', type: 'company', description: '' }], relations: [] }));
  const provider = createAnthropicProvider({ model: 'claude-opus-5-5', client });
  const out = await provider.extract({ text: 'A is a company.', documentTitle: 'Doc "1"' });
  assert.deepEqual(out, { entities: [{ name: 'A', type: 'company', description: '' }], relations: [] });
  const [params] = client.calls;
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.thinking, undefined);
  assert.match(params.messages[0].content, /<document title="Doc '1'">/);
});

test('anthropic provider maps answer output', async () => {
  const client = mockClient(textReply({ answer: 'X [1]', cited_sources: [1] }));
  const provider = createAnthropicProvider({ model: 'm', client });
  const out = await provider.answer({
    question: 'q',
    sources: [{ n: 1, title: 't', text: 'x' }],
    facts: ['a -[R]-> b'],
  });
  assert.deepEqual(out, { answer: 'X [1]', citedSources: [1] });
  assert.match(client.calls[0].messages[0].content, /<graph_facts>/);
});

test('anthropic provider handles refusals, truncation and malformed output', async () => {
  for (const [reply, code] of [
    [{ stop_reason: 'refusal', content: [] }, 'LLM_REFUSED'],
    [textReply({}, 'max_tokens'), 'LLM_TRUNCATED'],
    [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }, 'LLM_BAD_OUTPUT'],
  ]) {
    const provider = createAnthropicProvider({ model: 'm', client: mockClient(reply) });
    await assert.rejects(provider.extract({ text: 't', documentTitle: 'd' }), (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, code);
      return true;
    });
  }
});

test('anthropic provider maps SDK errors to service errors', async () => {
  const rateLimited = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
  const provider = createAnthropicProvider({ model: 'm', client: mockClient(rateLimited) });
  await assert.rejects(provider.extract({ text: 't', documentTitle: 'd' }), (err) => {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'LLM_RATE_LIMITED');
    return true;
  });
});
