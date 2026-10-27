'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { emptyState } = require('../domain/graph');

/**
 * @typedef {import('../domain/graph').GraphState} GraphState
 * @typedef {{ load(): Promise<GraphState>, save(state: GraphState): Promise<void>, describe(): string }} GraphStore
 */

/**
 * Persists the graph as a JSON file. Writes are atomic (temp file + rename) so a
 * crash mid-write never leaves a truncated graph behind. Single-writer by design:
 * run one replica per data directory.
 *
 * @param {string} filePath
 * @returns {GraphStore}
 */
function createJsonFileStore(filePath) {
  return {
    describe: () => `json-file:${filePath}`,
    async load() {
      let raw;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return emptyState();
        throw error;
      }
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
        throw new Error(`Unrecognized graph file format at ${filePath}`);
      }
      return parsed;
    },
    async save(state) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state), 'utf8');
      await fs.rename(tmp, filePath);
    },
  };
}

/**
 * In-memory store, used by tests.
 * @param {GraphState} [initial]
 * @returns {GraphStore}
 */
function createMemoryStore(initial) {
  let state = initial ? structuredClone(initial) : emptyState();
  return {
    describe: () => 'memory',
    async load() {
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
  };
}

module.exports = { createJsonFileStore, createMemoryStore };
