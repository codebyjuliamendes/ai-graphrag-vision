'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGraphRagService, mapLimit } = require('../src/services/graphRagService');
const { createMemoryStore, createJsonFileStore } = require('../src/storage/graphStore');
const { createDemoProvider } = require('../src/providers/demoProvider');

const OPTIONS = { chunkSize: 400, topK: 4, maxContextChars: 8000, extractionConcurrency: 2 };

/** Mocked LLM: fixed extraction, answer citing the first source. */
function fakeLlm(overrides = {}) {
  return {
    name: 'fake',
    demo: false,
    extractCalls: 0,
    async extract({ text }) {
      this.extractCalls += 1;
      const names = [...new Set(text.match(/\b[A-Z][a-z]+Corp\b/g) ?? [])];
      return {
        entities: names.map((name) => ({ name, type: 'company' })),
        relations:
          names.length > 1 ? [{ source: names[0], target: names[1], label: 'acquired', valid_from: 2023 }] : [],
      };
    },
    async answer() {
      return { answer: `Answer from source [1].`, citedSources: [1, 99] };
    },
    ...overrides,
  };
}

const build = async (provider = fakeLlm(), store = createMemoryStore()) => {
  const service = createGraphRagService({ store, provider, options: OPTIONS });
  await service.init();
  return { service, store, provider };
};

test('ingest builds the graph, persists it and de-duplicates identical documents', async () => {
  const { service, store, provider } = await build();
  const first = await service.ingestDocument({ title: 'Doc', text: 'AlphaCorp acquired BetaCorp in 2023.' });
  assert.equal(first.created, true);
  const again = await service.ingestDocument({ title: 'Other title', text: 'AlphaCorp acquired BetaCorp in 2023.' });
  assert.equal(again.created, false);
  assert.equal(again.document?.id, first.document?.id);
  assert.equal(provider.extractCalls, 1);
  const saved = await store.load();
  assert.equal(saved.relations[0].label, 'ACQUIRED', 'labels are normalized');
  assert.deepEqual(service.getGraph().stats, { documents: 1, chunks: 1, entities: 2, relations: 1 });
});

test('query returns only valid citations and highlights cited entities', async () => {
  const { service } = await build();
  await service.ingestDocument({ title: 'Doc', text: 'AlphaCorp acquired BetaCorp in 2023.' });
  const result = await service.query('What did AlphaCorp do?');
  assert.equal(result.answer, 'Answer from source [1].');
  assert.equal(result.citations.length, 1, 'out-of-range citation 99 is dropped');
  assert.equal(result.citations[0].documentTitle, 'Doc');
  assert.deepEqual(new Set(result.highlightedNodes), new Set(['alphacorp', 'betacorp']));
});

test('query without matching context does not call the LLM', async () => {
  let called = false;
  const { service } = await build(
    fakeLlm({
      async answer() {
        called = true;
        return { answer: 'x', citedSources: [] };
      },
    }),
  );
  const empty = await service.query('anything');
  assert.match(empty.answer, /No documents have been indexed/);
  await service.ingestDocument({ title: 'Doc', text: 'AlphaCorp acquired BetaCorp in 2023.' });
  const unrelated = await service.query('zebra migration');
  assert.match(unrelated.answer, /No relevant information/);
  assert.equal(called, false);
});

test('invalid provider output is rejected and leaves the graph untouched', async () => {
  const { service } = await build(
    fakeLlm({
      async extract() {
        return { entities: 'nope' };
      },
    }),
  );
  await assert.rejects(service.ingestDocument({ title: 'Doc', text: 'AlphaCorp acquired BetaCorp.' }), {
    code: 'LLM_BAD_OUTPUT',
  });
  assert.deepEqual(service.getGraph().stats, { documents: 0, chunks: 0, entities: 0, relations: 0 });
  // The queue keeps working after a failure.
  const ok = await createGraphRagService({ store: createMemoryStore(), provider: fakeLlm(), options: OPTIONS });
  await ok.init();
  assert.equal((await ok.ingestDocument({ title: 'x', text: 'AlphaCorp acquired BetaCorp.' })).created, true);
});

test('concurrent ingests are serialized without losing updates', async () => {
  const { service } = await build();
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      service.ingestDocument({ title: `Doc ${i}`, text: `GammaCorp acquired DeltaCorp. Version ${i}.` }),
    ),
  );
  assert.equal(service.getGraph().stats.documents, 5);
});

test('deleteDocument removes the document and 404s on unknown ids', async () => {
  const { service } = await build();
  const { document } = await service.ingestDocument({ title: 'Doc', text: 'AlphaCorp acquired BetaCorp.' });
  await service.deleteDocument(String(document?.id));
  assert.deepEqual(service.getGraph().stats, { documents: 0, chunks: 0, entities: 0, relations: 0 });
  await assert.rejects(service.deleteDocument('missing'), { status: 404 });
});

test('the graph survives a restart with the JSON file store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graphrag-'));
  const file = path.join(dir, 'nested', 'graph.json');
  const a = await build(createDemoProvider(), createJsonFileStore(file));
  await a.service.ingestDocument({
    title: 'Doc',
    text: 'NexCorp acquired OmniTech in 2023. Jane Doe is CEO of NexCorp.',
  });
  const b = await build(createDemoProvider(), createJsonFileStore(file));
  assert.equal(b.service.getGraph().stats.documents, 1);
  const answer = await b.service.query('Who acquired OmniTech?');
  assert.match(answer.answer, /NexCorp acquired OmniTech/);
  assert.equal(answer.demo, true);
  const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a corrupt graph file fails loudly instead of being overwritten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graphrag-'));
  const file = path.join(dir, 'graph.json');
  await fs.writeFile(file, '{"version": 99}');
  await assert.rejects(createJsonFileStore(file).load(), /Unrecognized graph file format/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('mapLimit preserves order and bounds concurrency', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, n));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [10, 2, 6, 4]);
  assert.equal(peak, 2);
});

test('excerpt shows the passage relevant to the question', () => {
  const { excerpt } = require('../src/services/graphRagService');
  const text = `${'Filler sentence about nothing. '.repeat(12)}NexCorp acquired OmniTech in 2023. More filler.`;
  const out = excerpt(text, 'Who acquired OmniTech?', 80);
  assert.match(out, /^…NexCorp acquired OmniTech in 2023\./);
  assert.ok(out.length <= 81);
  assert.equal(excerpt('short text', 'q'), 'short text');
});
