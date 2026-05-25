/**
 * JSON parser. Accepts:
 *   - A JSON array of objects: `[{...}, {...}]`
 *   - A JSON object wrapping an array under a known key: `{ data: [...] }`
 *     (with `arrayKey` option)
 *   - NDJSON / JSONL: one JSON object per line (with `format: 'ndjson'`)
 */

import type { ParsedRow } from '../types.js';

export interface JsonParseOptions {
  readonly format?: 'array' | 'ndjson';
  readonly arrayKey?: string;
}

export function parseJson(content: string, opts: JsonParseOptions = {}): readonly ParsedRow[] {
  const format = opts.format ?? 'array';

  if (format === 'ndjson') {
    const rows: ParsedRow[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows.push(Object.freeze({ ...(parsed as Record<string, unknown>) }));
      } else {
        throw new Error(`[analytics/parsers] NDJSON line is not an object: '${trimmed.slice(0, 60)}'`);
      }
    }
    return rows;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`[analytics/parsers] invalid JSON: ${(err as Error).message}`);
  }

  let array: unknown;
  if (Array.isArray(parsed)) {
    array = parsed;
  } else if (opts.arrayKey && typeof parsed === 'object' && parsed !== null) {
    array = (parsed as Record<string, unknown>)[opts.arrayKey];
  } else {
    throw new Error(`[analytics/parsers] JSON root must be an array (or supply arrayKey)`);
  }

  if (!Array.isArray(array)) {
    throw new Error(`[analytics/parsers] JSON did not yield an array at arrayKey '${opts.arrayKey}'`);
  }

  return array.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`[analytics/parsers] JSON row ${idx} is not an object`);
    }
    return Object.freeze({ ...(item as Record<string, unknown>) });
  });
}
