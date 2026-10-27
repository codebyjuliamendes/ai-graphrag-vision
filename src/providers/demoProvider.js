'use strict';

const { splitSentences, terms } = require('../domain/text');

/**
 * DEMO provider: deterministic, offline, rule-based. It does NOT use a language
 * model. Entity extraction is based on capitalization and keyword heuristics,
 * relations on a small verb lexicon, and answers are extractive (the most
 * relevant sentences of the retrieved chunks, with citations). Good enough to
 * exercise the whole pipeline end-to-end without credentials; use the
 * `anthropic` provider for real-world documents.
 *
 * @typedef {import('./types').LlmProvider} LlmProvider
 */

const LEADING_STOP = new Set(
  (
    'The A An In On At By For From With This That These Those It Its During After Before Since Until ' +
    'However Meanwhile Also Then When While As Our Their His Her According Despite Although Both Each ' +
    'Following Today Yesterday Last Next Every Overall Together Under Over Through All Some Most Many Several ' +
    'No Not We I You He She They Q1 Q2 Q3 Q4'
  ).split(/\s+/),
);
const MONTHS = new Set(
  'January February March April May June July August September October November December'.split(' '),
);
const CONNECTORS = new Set(['of', 'de', 'da', 'do', 'and', '&']);
const ROLE_TITLES = new Set(['CEO', 'CTO', 'CFO', 'COO', 'President', 'Founder', 'Chairman', 'Chairwoman', 'Director']);
const PRODUCT_SUFFIX = /\b(Platform|Engine|App|Suite|API|Model|System|Studio|Assistant|Framework|Network|Chip)$/;
const COMPANY_SUFFIX =
  /\b(Inc|Corp|Corporation|Ltd|LLC|SA|S\.A\.|GmbH|Group|Labs|Technologies|Systems|Bank|Company|Partners|Holdings|Ventures|Capital)\.?$/;
const PERSON_CONTEXT =
  /\b(CEO|CTO|CFO|COO|founder|co-founder|president|director|chief|chair(?:man|woman)?|head of|engineer|said|says|stated|led by|hired|appointed)\b/i;
const LOCATION_CONTEXT = /\b(?:in|based in|headquartered in|offices? in|located in|from)\s+$/i;
const METRIC_VALUE =
  /(?:US\$|R\$|\$|€|£)\s?\d[\d.,]*\s?(?:[MBK]\b|million|billion|thousand)?|[+-]?\d+(?:[.,]\d+)?\s?%/g;
const METRIC_KEYWORDS =
  /\b(revenue|revenues|profit|profits|net income|market share|growth|margin|sales|users|customers|valuation|funding|investment|costs?|ebitda|earnings)\b/gi;

/** Ordered: first match wins. */
const RELATION_LEXICON = [
  [/\bacquir(?:e|ed|es|ing)\b|\bbought\b|\bpurchased\b/i, 'ACQUIRED'],
  [/\bmerged? with\b/i, 'MERGED_WITH'],
  [/\bco-?founded\b|\bfounded\b/i, 'FOUNDED'],
  [/\bCEO of\b/i, 'CEO_OF'],
  [/\bCTO of\b/i, 'CTO_OF'],
  [/\bCFO of\b/i, 'CFO_OF'],
  [/\b(?:works? (?:at|for)|joined|employed by)\b/i, 'WORKS_AT'],
  [/\bpartner(?:ed|s|ship)? with\b/i, 'PARTNERED_WITH'],
  [/\binvest(?:ed|s)? in\b/i, 'INVESTED_IN'],
  [/\bcompet(?:es|ed|ing) with\b|\brival\b/i, 'COMPETES_WITH'],
  [/\b(?:headquartered|based|located) in\b/i, 'LOCATED_IN'],
  [/\b(?:developed|develops|built|builds|created|creates|designed)\b/i, 'DEVELOPED'],
  [/\blaunch(?:ed|es)?\b|\breleased\b|\bintroduced\b/i, 'LAUNCHED'],
  [/\b(?:uses|used|leverag(?:ed|es)|adopted|integrated)\b/i, 'USES'],
  [/\bannounc(?:ed|es)\b/i, 'ANNOUNCED'],
  [/\breport(?:ed|s)\b|\bposted\b|\brecorded\b/i, 'REPORTED'],
  [/\b(?:drove|drives|boosted|contributed to|fueled|powered)\b/i, 'CONTRIBUTED_TO'],
  [/\b(?:increased|grew|raised|improved)\b/i, 'INCREASED'],
  [/\b(?:decreased|reduced|cut|lowered)\b/i, 'DECREASED'],
  [/\b(?:expects?|forecasts?|projects?|guides?)\b/i, 'FORECASTS'],
  [/\bown(?:s|ed)\b|\bsubsidiary\b/i, 'OWNS'],
  [/\blead(?:s)?\b|\bled\b|\bmanag(?:es|ed)\b/i, 'LEADS'],
];

/**
 * @param {string} name
 * @param {string} sentence
 * @param {number} index position of the name inside the sentence
 * @returns {'company'|'person'|'product'|'location'|'concept'}
 */
function classify(name, sentence, index) {
  const words = name.split(/\s+/);
  if (PRODUCT_SUFFIX.test(name)) return 'product';
  if (COMPANY_SUFFIX.test(name)) return 'company';
  if (LOCATION_CONTEXT.test(sentence.slice(Math.max(0, index - 25), index)) && words.length <= 2) return 'location';
  if (words.length === 1 && /^[A-Z][a-z]+[A-Z][A-Za-z]*$/.test(name)) return 'company';
  if (words.length >= 2 && words.length <= 3 && words.every((w) => /^[A-Z][a-z'’-]+$/.test(w))) {
    if (PERSON_CONTEXT.test(sentence)) return 'person';
  }
  if (/\bcompany\b|\bstartup\b|\bfirm\b/i.test(sentence.slice(index, index + name.length + 30))) return 'company';
  return 'concept';
}

/**
 * Finds capitalized multi-word names in a sentence.
 * @param {string} sentence
 * @returns {{ name: string, index: number }[]}
 */
function findNames(sentence) {
  /** @type {{ name: string, index: number }[]} */
  const found = [];
  const re = /[A-Za-z0-9&'’.-]+/g;
  /** @type {{ word: string, index: number }[]} */
  let run = [];
  const flush = () => {
    while (run.length && CONNECTORS.has(run[run.length - 1].word)) run.pop();
    while (
      run.length &&
      (LEADING_STOP.has(run[0].word) ||
        MONTHS.has(run[0].word) ||
        ROLE_TITLES.has(run[0].word) ||
        CONNECTORS.has(run[0].word))
    ) {
      run.shift();
    }
    if (run.length) {
      const name = run
        .map((r) => r.word)
        .join(' ')
        .replace(/[.’']+$/, '')
        .replace(/['’]s$/, '');
      if (name.length >= 2 && !/^\d/.test(name) && !MONTHS.has(name)) found.push({ name, index: run[0].index });
    }
    run = [];
  };
  let m;
  let lastEnd = -1;
  while ((m = re.exec(sentence))) {
    const word = m[0];
    const gap = sentence.slice(lastEnd, m.index);
    const contiguous = lastEnd === -1 || /^\s+$/.test(gap);
    if (!contiguous) flush();
    const capitalized = /^[A-Z]/.test(word);
    if (capitalized) run.push({ word, index: m.index });
    else if (run.length && CONNECTORS.has(word)) run.push({ word, index: m.index });
    else flush();
    lastEnd = m.index + word.length;
    if (/[.,;:!?]$/.test(word) || /[,;:()]/.test(sentence[lastEnd] ?? '')) flush();
  }
  flush();
  return found;
}

/**
 * @param {string} sentence
 * @returns {{ name: string, index: number }[]}
 */
function findMetrics(sentence) {
  /** @type {{ name: string, index: number }[]} */
  const found = [];
  for (const m of sentence.matchAll(METRIC_VALUE)) {
    const index = m.index ?? 0;
    const before = sentence.slice(Math.max(0, index - 60), index);
    const keywords = [...before.matchAll(METRIC_KEYWORDS)];
    const keyword = keywords.length ? keywords[keywords.length - 1][0] : null;
    const value = m[0].replace(/\s+/g, ' ').trim();
    const name = keyword ? `${keyword[0].toUpperCase()}${keyword.slice(1).toLowerCase()} ${value}` : value;
    found.push({ name, index });
  }
  return found;
}

/**
 * @param {string} between
 * @returns {string | null}
 */
function relationLabel(between) {
  // The verb closest to the target wins ("a company founded in 2020 that developed X" -> DEVELOPED).
  let best = null;
  let bestIndex = -1;
  for (const [re, label] of RELATION_LEXICON) {
    const global = new RegExp(/** @type {RegExp} */ (re).source, 'gi');
    for (const m of between.matchAll(global)) {
      if ((m.index ?? -1) > bestIndex) {
        bestIndex = m.index ?? -1;
        best = /** @type {string} */ (label);
      }
    }
  }
  return best;
}

/** Relations whose endpoints must be organizations: [label, upgrade source?, upgrade target?]. */
const ORG_ROLES = /** @type {[string, boolean, boolean][]} */ ([
  ['ACQUIRED', true, true],
  ['MERGED_WITH', true, true],
  ['PARTNERED_WITH', true, true],
  ['LOCATED_IN', true, false],
  ['CEO_OF', false, true],
  ['CTO_OF', false, true],
  ['CFO_OF', false, true],
  ['WORKS_AT', false, true],
]);

/**
 * @param {string} text
 * @returns {import('../domain/graph').Extraction}
 */
function extractHeuristic(text) {
  /** @type {Map<string, { name: string, type: any }>} */
  const entities = new Map();
  /** @type {import('../domain/graph').Extraction['relations']} */
  const relations = [];

  for (const sentence of splitSentences(text)) {
    const mentions = [
      ...findNames(sentence).map((n) => ({ ...n, type: classify(n.name, sentence, n.index) })),
      ...findMetrics(sentence).map((n) => ({ ...n, type: /** @type {const} */ ('metric') })),
    ].sort((a, b) => a.index - b.index);

    for (const mention of mentions) {
      const key = mention.name.toLowerCase();
      const existing = entities.get(key);
      if (!existing || (existing.type === 'concept' && mention.type !== 'concept')) {
        entities.set(key, { name: mention.name, type: mention.type });
      }
    }

    const years = [...sentence.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
    const validFrom = years.length ? Math.min(...years) : null;
    const validUntil = years.length > 1 ? Math.max(...years) : null;

    for (let i = 0; i < mentions.length - 1; i += 1) {
      const a = mentions[i];
      const b = mentions[i + 1];
      if (a.name.toLowerCase() === b.name.toLowerCase()) continue;
      const between = sentence.slice(a.index + a.name.length, b.index);
      const label = relationLabel(between) ?? (between.trim().length <= 40 ? 'RELATED_TO' : null);
      if (!label) continue;
      relations.push({ source: a.name, target: b.name, label, valid_from: validFrom, valid_until: validUntil });
    }
  }

  for (const [label, upgradeSource, upgradeTarget] of ORG_ROLES) {
    for (const r of relations.filter((rel) => rel.label === label)) {
      for (const [flag, name] of [
        [upgradeSource, r.source],
        [upgradeTarget, r.target],
      ]) {
        const entity = entities.get(String(name).toLowerCase());
        if (flag && entity && entity.type === 'concept') entity.type = 'company';
      }
    }
  }

  return { entities: [...entities.values()].slice(0, 200), relations: relations.slice(0, 400) };
}

/** @returns {LlmProvider} */
function createDemoProvider() {
  return {
    name: 'demo',
    demo: true,
    async extract({ text }) {
      return extractHeuristic(text);
    },
    async answer({ question, sources }) {
      const qTerms = new Set(terms(question));
      /** @type {{ sentence: string, n: number, score: number, order: number }[]} */
      const candidates = [];
      let order = 0;
      for (const source of sources) {
        for (const sentence of splitSentences(source.text)) {
          const sTerms = new Set(terms(sentence));
          let score = 0;
          for (const t of qTerms) if (sTerms.has(t)) score += 1;
          // Earlier (higher-ranked) sources win ties.
          if (score > 0) candidates.push({ sentence, n: source.n, score: score - source.n * 0.01, order: order++ });
        }
      }
      const best = candidates.sort((a, b) => b.score - a.score).slice(0, 3);
      if (best.length === 0) {
        return {
          answer: 'No relevant information about this question was found in the indexed documents.',
          citedSources: [],
        };
      }
      best.sort((a, b) => a.order - b.order);
      return {
        answer: best.map((c) => `${c.sentence} [${c.n}]`).join(' '),
        citedSources: [...new Set(best.map((c) => c.n))],
      };
    },
  };
}

module.exports = { createDemoProvider, extractHeuristic, findNames };
