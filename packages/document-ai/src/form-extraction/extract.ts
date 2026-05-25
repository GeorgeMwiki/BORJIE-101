/**
 * extractFormFields — schema-guided structured extraction.
 *
 * Strategy:
 *   1. Run heuristic keyword-based extraction over every block; this
 *      always runs and gives us a high-precision baseline.
 *   2. If a BrainPort is supplied, call it with the doc + schema and
 *      merge: brain fills gaps, heuristics keep their high-confidence
 *      values. Brain outputs are validated through the Zod schema so
 *      we never propagate junk.
 *   3. Anything still missing is returned with `origin: 'missing'`
 *      and the schema-coerced default value (usually undefined).
 */

import { z } from 'zod';
import type {
  BrainPort,
  DocCitation,
  FormField,
  ParsedDocument,
  TextBlock,
} from '../types.js';
import type { NamedSchema } from './schemas.js';

export interface ExtractFormFieldsConfig {
  readonly doc: ParsedDocument;
  readonly schema: NamedSchema;
  readonly brain?: BrainPort;
  /** Lower bound for accepting a heuristic match. Default 0.6. */
  readonly minHeuristicConfidence?: number;
}

export async function extractFormFields(
  config: ExtractFormFieldsConfig
): Promise<FormField[]> {
  const minConf = config.minHeuristicConfidence ?? 0.6;
  const fieldNames = Object.keys(
    (config.schema.schema as z.ZodObject<z.ZodRawShape>).shape
  );

  const heuristic = extractHeuristic(config.doc, config.schema, minConf);
  const heuristicMap = new Map(heuristic.map((f) => [f.name, f]));

  let brainResults: FormField[] = [];
  if (config.brain) {
    brainResults = await extractWithBrain(config.brain, config.doc, config.schema);
  }
  const brainMap = new Map(brainResults.map((f) => [f.name, f]));

  return fieldNames.map<FormField>((name): FormField => {
    const heuristicHit = heuristicMap.get(name);
    const brainHit = brainMap.get(name);

    if (heuristicHit && heuristicHit.confidence >= 0.9) return heuristicHit;
    if (brainHit && brainHit.confidence >= 0.6) return brainHit;
    if (heuristicHit) return heuristicHit;
    return {
      name,
      value: undefined,
      confidence: 0,
      source: null,
      origin: 'missing',
    };
  });
}

function extractHeuristic(
  doc: ParsedDocument,
  schema: NamedSchema,
  minConfidence: number
): FormField[] {
  const out: FormField[] = [];
  for (const [field, keywords] of Object.entries(schema.keywords)) {
    const match = findKeywordMatch(doc, keywords);
    if (!match) continue;
    if (match.confidence < minConfidence) continue;
    out.push({
      name: field,
      value: match.value,
      confidence: match.confidence,
      source: match.source,
      origin: 'extracted',
    });
  }
  return out;
}

interface KeywordMatch {
  readonly value: string;
  readonly confidence: number;
  readonly source: DocCitation;
}

function findKeywordMatch(
  doc: ParsedDocument,
  keywords: ReadonlyArray<string>
): KeywordMatch | null {
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      const lower = block.text.toLowerCase();
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        const idx = lower.indexOf(kwLower);
        if (idx < 0) continue;
        // Require word boundary on the left so 'total:' doesn't match
        // 'subtotal:'. Index 0 always passes.
        if (idx > 0) {
          const prev = lower[idx - 1]!;
          if (/[a-z0-9]/.test(prev)) continue;
        }
        const after = block.text.slice(idx + kw.length).trim();
        const value = after.split(/[\n\r]/)[0]?.trim() ?? '';
        if (value.length === 0) continue;
        const confidence = Math.min(
          0.95,
          0.65 + (block.confidence - 0.85)
        );
        return {
          value,
          confidence,
          source: citationFor(doc.id, page.pageNumber, block, value),
        };
      }
    }
  }
  return null;
}

function citationFor(
  docId: string,
  pageNumber: number,
  block: TextBlock,
  quote: string
): DocCitation {
  return {
    docId,
    pageNumber,
    blockId: block.id,
    quote,
  };
}

async function extractWithBrain(
  brain: BrainPort,
  doc: ParsedDocument,
  schema: NamedSchema
): Promise<FormField[]> {
  const fieldNames = Object.keys(
    (schema.schema as z.ZodObject<z.ZodRawShape>).shape
  );

  const prompt = [
    `You are extracting structured form fields from a ${schema.label}.`,
    'Reply with a single JSON object — no commentary.',
    'Use null for fields you cannot find.',
    `FIELDS: ${fieldNames.join(', ')}`,
    `DOCUMENT:\n${doc.text.slice(0, 12000)}`,
  ].join('\n');

  const result = await brain.complete(prompt, { temperature: 0, maxTokens: 1024 });
  const json = safeParseJson(result.text);
  if (!json || typeof json !== 'object') return [];

  const parsed = schema.schema.safeParse(json);
  if (!parsed.success) {
    // Schema mismatch: still surface whatever fields are matching.
    return Object.entries(json as Record<string, unknown>)
      .filter(([name, value]) => fieldNames.includes(name) && value != null)
      .map<FormField>(([name, value]) => ({
        name,
        value,
        confidence: 0.55,
        source: null,
        origin: 'inferred',
      }));
  }

  const data = parsed.data as Record<string, unknown>;
  return fieldNames
    .filter((name) => data[name] !== undefined && data[name] !== null)
    .map<FormField>((name) => ({
      name,
      value: data[name],
      confidence: 0.78,
      source: null,
      origin: 'inferred',
    }));
}

function safeParseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip a Markdown code fence if present.
  const stripped = trimmed.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/m, '$1');
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to extract the first {...} block.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
