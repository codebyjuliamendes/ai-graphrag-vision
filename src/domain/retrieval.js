'use strict';

const { terms } = require('./text');

/**
 * @typedef {import('./graph').GraphState} GraphState
 * @typedef {import('./graph').Chunk} Chunk
 * @typedef {{ chunk: Chunk, score: number }} ScoredChunk
 * @typedef {{
 *   seeds: string[],
 *   subgraph: string[],
 *   chunks: ScoredChunk[],
 *   facts: string[],
 * }} RetrievalResult
 */

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Finds the entities named in the question. An entity matches when the
 * question contains its full name or the majority of its (non-stopword) terms.
 * @param {GraphState} state
 * @param {string} question
 * @returns {string[]}
 */
function matchEntities(state, question) {
  const lowered = question.toLowerCase();
  const qTerms = new Set(terms(question));
  /** @type {{ id: string, score: number }[]} */
  const matches = [];
  for (const entity of state.entities) {
    const escaped = entity.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(lowered)) {
      matches.push({ id: entity.id, score: 2 });
      continue;
    }
    const nameTerms = [...new Set(terms(entity.name))].filter((t) => !/^\d+$/.test(t));
    if (nameTerms.length === 0) continue;
    const hits = nameTerms.filter((t) => qTerms.has(t)).length;
    const ratio = hits / nameTerms.length;
    if (hits > 0 && ratio >= 0.5) matches.push({ id: entity.id, score: ratio });
  }
  return matches.sort((a, b) => b.score - a.score).map((m) => m.id);
}

/**
 * Hybrid graph + lexical retrieval:
 *  1. entities named in the question are the seeds;
 *  2. the subgraph is the seeds plus their 1-hop neighbours;
 *  3. chunks are ranked by BM25 against the question, boosted when they mention
 *     seed / neighbour entities, and packed into a character budget.
 *
 * @param {GraphState} state
 * @param {string} question
 * @param {{ topK: number, maxContextChars: number, maxFacts?: number }} options
 * @returns {RetrievalResult}
 */
function retrieve(state, question, { topK, maxContextChars, maxFacts = 40 }) {
  const seeds = matchEntities(state, question);
  const seedSet = new Set(seeds);
  const subgraph = new Set(seeds);
  for (const r of state.relations) {
    if (seedSet.has(r.source)) subgraph.add(r.target);
    if (seedSet.has(r.target)) subgraph.add(r.source);
  }

  // Which entities each chunk mentions.
  /** @type {Map<string, Set<string>>} */
  const chunkEntities = new Map();
  for (const e of state.entities) {
    for (const chunkId of e.mentions) {
      if (!chunkEntities.has(chunkId)) chunkEntities.set(chunkId, new Set());
      chunkEntities.get(chunkId)?.add(e.id);
    }
  }

  const qTerms = [...new Set(terms(question))];
  const docs = state.chunks.map((c) => terms(c.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(docs.length, 1);
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;

  /** @type {ScoredChunk[]} */
  const scored = state.chunks.map((chunk, i) => {
    const d = docs[i];
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of qTerms) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * (f * (BM25_K1 + 1))) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / avgLen));
    }
    const mentioned = chunkEntities.get(chunk.id) ?? new Set();
    for (const id of mentioned) {
      if (seedSet.has(id)) score += 1;
      else if (subgraph.has(id)) score += 0.25;
    }
    return { chunk, score };
  });

  /** @type {ScoredChunk[]} */
  const selected = [];
  let used = 0;
  for (const item of scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)) {
    if (selected.length >= topK) break;
    if (used + item.chunk.text.length > maxContextChars && selected.length > 0) continue;
    selected.push(item);
    used += item.chunk.text.length;
  }

  const names = new Map(state.entities.map((e) => [e.id, e.name]));
  const facts = state.relations
    .filter((r) => (seedSet.has(r.source) || seedSet.has(r.target)) && subgraph.has(r.source) && subgraph.has(r.target))
    .slice(0, maxFacts)
    .map((r) => {
      const period =
        r.valid_from != null || r.valid_until != null ? ` (${r.valid_from ?? '?'}–${r.valid_until ?? 'present'})` : '';
      return `${names.get(r.source)} -[${r.label}]-> ${names.get(r.target)}${period}`;
    });

  return { seeds, subgraph: [...subgraph], chunks: selected, facts };
}

module.exports = { retrieve, matchEntities };
