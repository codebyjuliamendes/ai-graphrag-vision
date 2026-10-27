'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyState, mergeExtraction, removeDocument, toCytoscape, stats } = require('../src/domain/graph');

const chunk = (id, documentId = 'd1') => ({ id, documentId, index: 0, text: '' });

test('mergeExtraction de-duplicates entities and keeps provenance', () => {
  const state = emptyState();
  mergeExtraction(state, chunk('c1'), {
    entities: [
      { name: 'NexCorp', type: 'concept' },
      { name: 'OmniTech', type: 'company' },
    ],
    relations: [{ source: 'NexCorp', target: 'OmniTech', label: 'ACQUIRED', valid_from: 2023, valid_until: null }],
  });
  mergeExtraction(state, chunk('c2'), {
    entities: [{ name: 'nexcorp', type: 'company' }],
    relations: [{ source: 'NexCorp', target: 'OmniTech', label: 'ACQUIRED', valid_from: 2022, valid_until: 2025 }],
  });
  assert.equal(state.entities.length, 2);
  const nex = state.entities.find((e) => e.id === 'nexcorp');
  assert.equal(nex?.type, 'company', 'specific type replaces concept');
  assert.deepEqual(nex?.mentions, ['c1', 'c2']);
  assert.equal(state.relations.length, 1);
  assert.deepEqual(state.relations[0].chunkIds, ['c1', 'c2']);
  assert.equal(state.relations[0].valid_from, 2022);
  assert.equal(state.relations[0].valid_until, 2025);
});

test('mergeExtraction creates missing endpoints, skips self-loops and orders bounds', () => {
  const state = emptyState();
  mergeExtraction(state, chunk('c1'), {
    entities: [],
    relations: [
      { source: 'A Corp', target: 'B Corp', label: 'OWNS', valid_from: 2025, valid_until: 2020 },
      { source: 'A Corp', target: 'a corp', label: 'OWNS' },
    ],
  });
  assert.equal(state.entities.length, 2);
  assert.equal(state.relations.length, 1);
  assert.equal(state.relations[0].valid_from, 2020);
  assert.equal(state.relations[0].valid_until, 2025);
});

test('removeDocument drops only what the document supported', () => {
  const state = emptyState();
  state.documents.push({ id: 'd1', title: '', sha256: '', createdAt: '', chunkIds: ['c1'] });
  state.documents.push({ id: 'd2', title: '', sha256: '', createdAt: '', chunkIds: ['c2'] });
  state.chunks.push(chunk('c1', 'd1'), chunk('c2', 'd2'));
  mergeExtraction(state, chunk('c1', 'd1'), {
    entities: [
      { name: 'X', type: 'company' },
      { name: 'Y', type: 'company' },
    ],
    relations: [{ source: 'X', target: 'Y', label: 'OWNS' }],
  });
  mergeExtraction(state, chunk('c2', 'd2'), {
    entities: [
      { name: 'X', type: 'company' },
      { name: 'Z', type: 'company' },
    ],
    relations: [{ source: 'X', target: 'Z', label: 'OWNS' }],
  });
  const next = removeDocument(state, 'd1');
  assert.deepEqual(stats(next), { documents: 1, chunks: 1, entities: 2, relations: 1 });
  assert.deepEqual(
    next.entities.map((e) => e.id),
    ['x', 'z'],
  );
  assert.equal(stats(state).entities, 3, 'original state is not mutated');
});

test('toCytoscape exposes nodes and edges with degree', () => {
  const state = emptyState();
  mergeExtraction(state, chunk('c1'), {
    entities: [{ name: 'X', type: 'company' }],
    relations: [{ source: 'X', target: 'Y', label: 'OWNS', valid_from: 2021 }],
  });
  const { nodes, edges } = toCytoscape(state);
  assert.equal(nodes.find((n) => n.data.id === 'x')?.data.degree, 1);
  assert.deepEqual(edges[0].data, {
    id: 'x|OWNS|y',
    source: 'x',
    target: 'y',
    label: 'OWNS',
    valid_from: 2021,
    valid_until: null,
    sources: 1,
  });
});
