'use strict';

/**
 * Pure text utilities shared by chunking, extraction and retrieval.
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in into ' +
    'is it its me my no not of on or our so than that the their them then there these they this to ' +
    'was we were what when where which who whom why will with would you your about after again all ' +
    'also any because before being between both during each few more most other over same some such ' +
    'through under until up very just did tell show explain describe give list know'
  ).split(/\s+/),
);

/**
 * Lower-cases, strips accents and splits text into alphanumeric terms.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9$%]+/)
    .filter(Boolean);
}

/**
 * Very small stemmer: folds common English plural / verb suffixes so that
 * "profits" matches "profit" and "acquired" matches "acquire".
 * @param {string} term
 * @returns {string}
 */
function stem(term) {
  if (term.length <= 3) return term;
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith('ing') && term.length > 5) return term.slice(0, -3);
  if (term.endsWith('ed') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('es') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

/**
 * Tokenizes, removes stopwords and stems.
 * @param {string} text
 * @returns {string[]}
 */
function terms(text) {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Splits text into sentences. Line breaks (headings, list items) always end a sentence;
 * markdown heading / bullet markers are stripped.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+/, ''))
    .flatMap((line) => line.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds a stable identifier from an entity name ("Jane Doe" -> "jane-doe").
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'entity'
  );
}

module.exports = { STOPWORDS, tokenize, stem, terms, splitSentences, slugify };
