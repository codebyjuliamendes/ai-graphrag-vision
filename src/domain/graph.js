'use strict';

const { slugify } = require('./text');

/**
 * @typedef {{ id: string, title: string, sha256: string, createdAt: string, chunkIds: string[] }} DocumentRecord
 * @typedef {{ id: string, documentId: string, index: number, text: string }} Chunk
 * @typedef {{ id: string, name: string, type: string, description?: string, mentions: string[] }} Entity
 * @typedef {{ id: string, source: string, target: string, label: string, chunkIds: string[],
 *             valid_from: number | null, valid_until: number | null }} Relation
 * @typedef {{ version: 1, documents: DocumentRecord[], chunks: Chunk[], entities: Entity[], relations: Relation[] }} GraphState
 * @typedef {import('zod').infer<typeof import('./schemas').extractionSchema>} Extraction
 */

/** @returns {GraphState} */
function emptyState() {
  return { version: 1, documents: [], chunks: [], entities: [], relations: [] };
}

/**
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 * @param {(x: number, y: number) => number} pick
 * @returns {number | null}
 */
function mergeBound(a, b, pick) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return pick(a, b);
}

/**
 * Merges the entities/relations extracted from one chunk into `state` (mutates it).
 * Entities are de-duplicated by normalized name; every entity and relation keeps
 * the ids of the chunks it was extracted from, which is what makes citations possible.
 *
 * @param {GraphState} state
 * @param {Chunk} chunk
 * @param {Extraction} extraction
 */
function mergeExtraction(state, chunk, extraction) {
  const byId = new Map(state.entities.map((e) => [e.id, e]));

  /**
   * @param {string} name
   * @param {string} type
   * @param {string} [description]
   */
  const upsertEntity = (name, type, description) => {
    const id = slugify(name);
    let entity = byId.get(id);
    if (!entity) {
      entity = { id, name, type, mentions: [] };
      if (description) entity.description = description;
      state.entities.push(entity);
      byId.set(id, entity);
    } else {
      if (entity.type === 'concept' && type !== 'concept') entity.type = type;
      if (!entity.description && description) entity.description = description;
    }
    if (!entity.mentions.includes(chunk.id)) entity.mentions.push(chunk.id);
    return entity;
  };

  for (const e of extraction.entities) upsertEntity(e.name, e.type, e.description);

  const relById = new Map(state.relations.map((r) => [r.id, r]));
  for (const r of extraction.relations) {
    const source = upsertEntity(r.source, byId.get(slugify(r.source))?.type ?? 'concept');
    const target = upsertEntity(r.target, byId.get(slugify(r.target))?.type ?? 'concept');
    if (source.id === target.id) continue;
    let from = r.valid_from ?? null;
    let until = r.valid_until ?? null;
    if (from != null && until != null && from > until) [from, until] = [until, from];
    const id = `${source.id}|${r.label}|${target.id}`;
    const existing = relById.get(id);
    if (existing) {
      if (!existing.chunkIds.includes(chunk.id)) existing.chunkIds.push(chunk.id);
      existing.valid_from = mergeBound(existing.valid_from, from, Math.min);
      existing.valid_until = mergeBound(existing.valid_until, until, Math.max);
    } else {
      const relation = {
        id,
        source: source.id,
        target: target.id,
        label: r.label,
        chunkIds: [chunk.id],
        valid_from: from,
        valid_until: until,
      };
      state.relations.push(relation);
      relById.set(id, relation);
    }
  }
}

/**
 * Returns a new state without the given document and everything only it supported.
 * @param {GraphState} state
 * @param {string} documentId
 * @returns {GraphState}
 */
function removeDocument(state, documentId) {
  const removed = new Set(state.chunks.filter((c) => c.documentId === documentId).map((c) => c.id));
  const entities = state.entities
    .map((e) => ({ ...e, mentions: e.mentions.filter((m) => !removed.has(m)) }))
    .filter((e) => e.mentions.length > 0);
  const alive = new Set(entities.map((e) => e.id));
  const relations = state.relations
    .map((r) => ({ ...r, chunkIds: r.chunkIds.filter((c) => !removed.has(c)) }))
    .filter((r) => r.chunkIds.length > 0 && alive.has(r.source) && alive.has(r.target));
  return {
    version: 1,
    documents: state.documents.filter((d) => d.id !== documentId),
    chunks: state.chunks.filter((c) => !removed.has(c.id)),
    entities,
    relations,
  };
}

/**
 * Serializes the graph in the element format Cytoscape.js expects.
 * @param {GraphState} state
 */
function toCytoscape(state) {
  /** @type {Map<string, number>} */
  const degree = new Map();
  for (const r of state.relations) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }
  return {
    nodes: state.entities.map((e) => ({
      data: {
        id: e.id,
        label: e.name,
        type: e.type,
        description: e.description ?? null,
        degree: degree.get(e.id) ?? 0,
        mentions: e.mentions.length,
      },
    })),
    edges: state.relations.map((r) => ({
      data: {
        id: r.id,
        source: r.source,
        target: r.target,
        label: r.label,
        valid_from: r.valid_from,
        valid_until: r.valid_until,
        sources: r.chunkIds.length,
      },
    })),
  };
}

/**
 * @param {GraphState} state
 */
function stats(state) {
  return {
    documents: state.documents.length,
    chunks: state.chunks.length,
    entities: state.entities.length,
    relations: state.relations.length,
  };
}

module.exports = { emptyState, mergeExtraction, removeDocument, toCytoscape, stats };
