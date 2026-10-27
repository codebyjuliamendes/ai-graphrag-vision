'use strict';

const { z } = require('zod');

const ENTITY_TYPES = /** @type {const} */ (['company', 'person', 'product', 'metric', 'location', 'concept']);

const year = z.number().int().min(1000).max(9999);

/** Output contract every LLM provider's `extract` must satisfy. */
const extractionSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        type: z.enum(ENTITY_TYPES).catch('concept'),
        description: z.string().trim().max(300).optional(),
      }),
    )
    .max(200),
  relations: z
    .array(
      z.object({
        source: z.string().trim().min(1).max(120),
        target: z.string().trim().min(1).max(120),
        label: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .transform((l) =>
            l
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '_')
              .replace(/^_+|_+$/g, ''),
          )
          .pipe(z.string().min(1)),
        valid_from: year.optional().nullable(),
        valid_until: year.optional().nullable(),
      }),
    )
    .max(400),
});

/** Output contract every LLM provider's `answer` must satisfy. */
const answerSchema = z.object({
  answer: z.string().trim().min(1).max(8000),
  citedSources: z.array(z.number().int().min(1)).max(50),
});

/**
 * Builds request-body schemas bounded by runtime configuration.
 * @param {{ maxDocumentChars: number }} limits
 */
function requestSchemas({ maxDocumentChars }) {
  return {
    document: z.object({
      title: z.string().trim().min(1, 'title is required').max(200),
      text: z
        .string()
        .trim()
        .min(20, 'text must have at least 20 characters')
        .max(maxDocumentChars, `text must have at most ${maxDocumentChars} characters`),
    }),
    query: z.object({
      query: z
        .string({ error: '"query" must be a non-empty string.' })
        .trim()
        .min(1, '"query" must be a non-empty string.')
        .max(2000, '"query" must have at most 2000 characters.'),
    }),
  };
}

module.exports = { ENTITY_TYPES, extractionSchema, answerSchema, requestSchemas };
