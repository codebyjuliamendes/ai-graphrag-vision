'use strict';

const { splitSentences } = require('./text');

/**
 * Splits a document into chunks of at most `maxChars` characters, respecting
 * paragraph and sentence boundaries whenever possible. A single sentence longer
 * than the limit is hard-wrapped so no chunk ever exceeds `maxChars`.
 *
 * @param {string} text
 * @param {{ maxChars: number }} options
 * @returns {string[]}
 */
function chunkText(text, { maxChars }) {
  if (!Number.isInteger(maxChars) || maxChars < 50) {
    throw new RangeError('maxChars must be an integer >= 50');
  }
  /** @type {string[]} */
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      const pieces = [];
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars));
      for (const piece of pieces) {
        const candidate = current ? `${current}${current.endsWith('\n') ? '' : ' '}${piece}` : piece;
        if (candidate.length > maxChars) {
          flush();
          current = piece;
        } else {
          current = candidate;
        }
      }
    }
    // Paragraph boundary: start a new chunk when the current one is already reasonably full,
    // otherwise keep the boundary as a line break so sentence splitting still sees it.
    if (current.length >= maxChars / 2) flush();
    else if (current) current += '\n';
  }
  flush();
  return chunks;
}

module.exports = { chunkText };
