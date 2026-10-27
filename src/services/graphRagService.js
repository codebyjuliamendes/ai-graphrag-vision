'use strict';

const crypto = require('node:crypto');
const { chunkText } = require('../domain/chunker');
const { emptyState, mergeExtraction, removeDocument, toCytoscape, stats } = require('../domain/graph');
const { retrieve } = require('../domain/retrieval');
const { extractionSchema, answerSchema } = require('../domain/schemas');
const { terms, splitSentences } = require('../domain/text');
const { AppError } = require('../errors');

/**
 * @typedef {import('../domain/graph').GraphState} GraphState
 * @typedef {import('../storage/graphStore').GraphStore} GraphStore
 * @typedef {import('../providers/types').LlmProvider} LlmProvider
 * @typedef {{ chunkSize: number, topK: number, maxContextChars: number, extractionConcurrency: number }} ServiceOptions
 */

/**
 * Runs `fn` over `items` with at most `limit` promises in flight, preserving order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Returns the part of a chunk most relevant to the question (up to `max` chars),
 * so citations show the supporting passage rather than the chunk's first line.
 * @param {string} text
 * @param {string} question
 * @param {number} [max]
 */
function excerpt(text, question, max = 280) {
  if (text.length <= max) return text;
  const qTerms = new Set(terms(question));
  const sentences = splitSentences(text);
  let best = 0;
  let bestScore = -1;
  sentences.forEach((s, i) => {
    const score = terms(s).filter((t) => qTerms.has(t)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  let out = sentences[best] ?? '';
  for (let i = best + 1; i < sentences.length && out.length + sentences[i].length + 1 <= max; i += 1) {
    out += ` ${sentences[i]}`;
  }
  const clipped = out.length <= max ? out : `${out.slice(0, max - 1).trimEnd()}…`;
  return best > 0 ? `…${clipped}` : clipped;
}

/**
 * Application service: document ingestion (chunk -> extract -> merge -> persist)
 * and question answering (retrieve -> answer -> cite).
 *
 * @param {{ store: GraphStore, provider: LlmProvider, options: ServiceOptions }} deps
 */
function createGraphRagService({ store, provider, options }) {
  /** @type {GraphState} */
  let state = emptyState();
  let ready = false;
  /** Serializes mutations so concurrent writes never lose updates. */
  let queue = Promise.resolve();

  /**
   * @template T
   * @param {(current: GraphState) => Promise<{ next: GraphState | null, result: T }>} fn
   * @returns {Promise<T>}
   */
  const mutate = (fn) => {
    const run = queue.then(async () => {
      const { next, result } = await fn(state);
      if (next) {
        await store.save(next);
        state = next;
      }
      return result;
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const ensureReady = () => {
    if (!ready) throw new AppError(503, 'NOT_READY', 'The service is still starting.');
  };

  /**
   * @param {GraphState} current
   * @param {string} documentId
   */
  const documentSummary = (current, documentId) => {
    const doc = current.documents.find((d) => d.id === documentId);
    if (!doc) return null;
    return { id: doc.id, title: doc.title, createdAt: doc.createdAt, chunks: doc.chunkIds.length };
  };

  return {
    provider: { name: provider.name, demo: provider.demo },

    async init() {
      state = await store.load();
      ready = true;
    },

    isReady: () => ready,

    getGraph() {
      ensureReady();
      return { ...toCytoscape(state), stats: stats(state) };
    },

    listDocuments() {
      ensureReady();
      return state.documents.map((d) => documentSummary(state, d.id));
    },

    /**
     * @param {{ title: string, text: string }} input
     */
    ingestDocument(input) {
      ensureReady();
      const sha256 = crypto.createHash('sha256').update(input.text).digest('hex');
      return mutate(async (current) => {
        const duplicate = current.documents.find((d) => d.sha256 === sha256);
        if (duplicate)
          return { next: null, result: { created: false, document: documentSummary(current, duplicate.id) } };

        const documentId = `doc_${crypto.randomUUID()}`;
        const pieces = chunkText(input.text, { maxChars: options.chunkSize });
        if (pieces.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'The document has no text content.');
        const chunks = pieces.map((text, index) => ({ id: `${documentId}:${index}`, documentId, index, text }));

        const extractions = await mapLimit(chunks, options.extractionConcurrency, async (chunk) => {
          const raw = await provider.extract({ text: chunk.text, documentTitle: input.title });
          const parsed = extractionSchema.safeParse(raw);
          if (!parsed.success) {
            throw new AppError(502, 'LLM_BAD_OUTPUT', 'The language model returned an invalid extraction.', {
              cause: parsed.error,
            });
          }
          return parsed.data;
        });

        const next = structuredClone(current);
        next.documents.push({
          id: documentId,
          title: input.title,
          sha256,
          createdAt: new Date().toISOString(),
          chunkIds: chunks.map((c) => c.id),
        });
        next.chunks.push(...chunks);
        chunks.forEach((chunk, i) => mergeExtraction(next, chunk, extractions[i]));
        return { next, result: { created: true, document: documentSummary(next, documentId) } };
      });
    },

    /**
     * @param {string} documentId
     */
    deleteDocument(documentId) {
      ensureReady();
      return mutate(async (current) => {
        if (!current.documents.some((d) => d.id === documentId)) {
          throw new AppError(404, 'NOT_FOUND', 'Document not found.');
        }
        return { next: removeDocument(current, documentId), result: { deleted: true } };
      });
    },

    /**
     * @param {string} question
     */
    async query(question) {
      ensureReady();
      const snapshot = state;
      const retrieval = retrieve(snapshot, question, {
        topK: options.topK,
        maxContextChars: options.maxContextChars,
      });
      const base = { provider: provider.name, demo: provider.demo, facts: retrieval.facts };

      if (retrieval.chunks.length === 0) {
        return {
          ...base,
          answer:
            snapshot.documents.length === 0
              ? 'No documents have been indexed yet. Add a document first.'
              : 'No relevant information about this question was found in the indexed documents.',
          highlightedNodes: [],
          citations: [],
        };
      }

      const titles = new Map(snapshot.documents.map((d) => [d.id, d.title]));
      const sources = retrieval.chunks.map(({ chunk }, i) => ({
        n: i + 1,
        title: titles.get(chunk.documentId) ?? 'Untitled',
        text: chunk.text,
        chunk,
      }));

      const parsed = answerSchema.safeParse(
        await provider.answer({
          question,
          sources: sources.map(({ n, title, text }) => ({ n, title, text })),
          facts: retrieval.facts,
        }),
      );
      if (!parsed.success) {
        throw new AppError(502, 'LLM_BAD_OUTPUT', 'The language model returned an invalid answer.', {
          cause: parsed.error,
        });
      }

      const cited = new Set(parsed.data.citedSources.filter((n) => n >= 1 && n <= sources.length));
      const citedSources = sources.filter((s) => cited.has(s.n));
      const citedChunkIds = new Set(citedSources.map((s) => s.chunk.id));
      const subgraph = new Set(retrieval.subgraph);
      const highlighted = new Set(retrieval.seeds);
      for (const e of snapshot.entities) {
        const inCited = e.mentions.some((m) => citedChunkIds.has(m));
        if (inCited && (subgraph.size === 0 || subgraph.has(e.id))) highlighted.add(e.id);
      }

      return {
        ...base,
        answer: parsed.data.answer,
        highlightedNodes: [...highlighted],
        citations: citedSources.map((s) => ({
          n: s.n,
          documentId: s.chunk.documentId,
          documentTitle: s.title,
          chunkId: s.chunk.id,
          excerpt: excerpt(s.text, question),
        })),
      };
    },
  };
}

module.exports = { createGraphRagService, mapLimit, excerpt };
