'use strict';

/**
 * Provider contract. Any LLM backend (or the offline demo) implements this.
 *
 * @typedef {{ n: number, title: string, text: string }} AnswerSource
 * @typedef {{
 *   name: string,
 *   demo: boolean,
 *   extract(input: { text: string, documentTitle: string }): Promise<unknown>,
 *   answer(input: { question: string, sources: AnswerSource[], facts: string[] }): Promise<unknown>,
 * }} LlmProvider
 *
 * Outputs are `unknown` on purpose: the service validates them against
 * `extractionSchema` / `answerSchema`, so a misbehaving provider cannot corrupt the graph.
 */

module.exports = {};
