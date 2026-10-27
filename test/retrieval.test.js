'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyState, mergeExtraction } = require('../src/domain/graph');
const { retrieve, matchEntities } = require('../src/domain/retrieval');

function fixture() {
  const state = emptyState();
  const texts = [
    'NexCorp acquired OmniTech in 2023.',
    'OmniTech developed the Atlas AI Platform.',
    'The weather in Lisbon was sunny all week.',
  ];
  texts.forEach((text, index) => state.chunks.push({ id: `c${index}`, documentId: 'd1', index, text }));
  mergeExtraction(state, state.chunks[0], {
    entities: [
      { name: 'NexCorp', type: 'company' },
      { name: 'OmniTech', type: 'company' },
    ],
    relations: [{ source: 'NexCorp', target: 'OmniTech', label: 'ACQUIRED', valid_from: 2023 }],
  });
  mergeExtraction(state, state.chunks[1], {
    entities: [{ name: 'Atlas AI Platform', type: 'product' }],
    relations: [{ source: 'OmniTech', target: 'Atlas AI Platform', label: 'DEVELOPED' }],
  });
  mergeExtraction(state, state.chunks[2], { entities: [{ name: 'Lisbon', type: 'location' }], relations: [] });
  return state;
}

test('matchEntities finds full and partial names', () => {
  const state = fixture();
  assert.deepEqual(matchEntities(state, 'Who bought omnitech?'), ['omnitech']);
  assert.deepEqual(matchEntities(state, 'Tell me about the Atlas platform'), ['atlas-ai-platform']);
  assert.deepEqual(matchEntities(state, 'unrelated question'), []);
  // Whole-word matching: "AI" must not match inside "said".
  state.entities.push({ id: 'ai', name: 'AI', type: 'concept', mentions: [] });
  assert.deepEqual(matchEntities(state, 'What was said?'), []);
  assert.deepEqual(matchEntities(state, 'What about AI?'), ['ai']);
});

test('retrieve expands one hop and ranks relevant chunks first', () => {
  const state = fixture();
  const result = retrieve(state, 'What did OmniTech develop?', { topK: 2, maxContextChars: 10_000 });
  assert.deepEqual(result.seeds, ['omnitech']);
  assert.deepEqual(new Set(result.subgraph), new Set(['omnitech', 'nexcorp', 'atlas-ai-platform']));
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0].chunk.id, 'c1');
  assert.ok(!result.chunks.some((c) => c.chunk.id === 'c2'), 'irrelevant chunk is excluded');
  assert.ok(result.facts.includes('NexCorp -[ACQUIRED]-> OmniTech (2023–present)'));
});

test('retrieve returns nothing for questions unrelated to the corpus', () => {
  const result = retrieve(fixture(), 'quantum chromodynamics', { topK: 5, maxContextChars: 10_000 });
  assert.equal(result.chunks.length, 0);
});

test('retrieve honours the context budget', () => {
  const result = retrieve(fixture(), 'NexCorp OmniTech Atlas', { topK: 5, maxContextChars: 40 });
  assert.equal(result.chunks.length, 1);
});
