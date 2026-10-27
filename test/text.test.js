'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { terms, stem, splitSentences, slugify } = require('../src/domain/text');
const { chunkText } = require('../src/domain/chunker');

test('terms removes stopwords, accents and folds plurals', () => {
  assert.deepEqual(terms('What are the Profits of São Paulo?'), ['profit', 'sao', 'paulo']);
  assert.equal(stem('companies'), 'company');
  assert.equal(stem('acquired'), 'acquir');
  assert.equal(stem('acquire'), 'acquire');
});

test('splitSentences keeps decimals and splits on line breaks', () => {
  assert.deepEqual(splitSentences('# Title\nRevenue was $1.2 billion. Profit grew 15%.\n- item'), [
    'Title',
    'Revenue was $1.2 billion.',
    'Profit grew 15%.',
    'item',
  ]);
});

test('slugify builds stable ids', () => {
  assert.equal(slugify('  Jane Doe '), 'jane-doe');
  assert.equal(slugify('Ação & Cia.'), 'acao-cia');
  assert.equal(slugify('!!!'), 'entity');
});

test('chunkText respects the size limit and sentence boundaries', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about NexCorp.`).join(' ');
  const chunks = chunkText(text, { maxChars: 200 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 200, `chunk too long: ${c.length}`);
    assert.match(c, /\.$/);
  }
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text);
});

test('chunkText hard-wraps a sentence longer than the limit', () => {
  const chunks = chunkText('x'.repeat(450), { maxChars: 200 });
  assert.deepEqual(
    chunks.map((c) => c.length),
    [200, 200, 50],
  );
});

test('chunkText rejects invalid sizes', () => {
  assert.throws(() => chunkText('abc', { maxChars: 10 }), RangeError);
});
