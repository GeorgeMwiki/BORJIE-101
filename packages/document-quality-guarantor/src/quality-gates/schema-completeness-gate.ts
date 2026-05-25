/**
 * schemaCompletenessGate — verifies every required field in the schema
 * is present, non-null, and (for strings) non-empty.
 *
 * The gate takes a Zod schema (or a string[] of required field paths)
 * and a flat field map. Missing fields produce a per-field reason; the
 * gate's numeric score is the fraction of required fields present.
 */

import type { QualityReport } from '../types.js';
import type { Gate, SchemaCompletenessGateInput } from './types.js';

export interface SchemaCompletenessGateOptions {
  readonly requiredFields: ReadonlyArray<string>;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function schemaCompletenessGate(
  opts: SchemaCompletenessGateOptions,
): Gate<SchemaCompletenessGateInput> {
  const required = opts.requiredFields;
  return {
    id: 'schemaCompletenessGate',
    async evaluate({ fields }): Promise<QualityReport> {
      const missing: string[] = [];
      for (const path of required) {
        if (!isPresent(fields[path])) missing.push(path);
      }
      const presentCount = required.length - missing.length;
      const value = required.length === 0 ? 1 : presentCount / required.length;
      const passed = missing.length === 0;
      return {
        gateId: 'schemaCompletenessGate',
        score: { value, threshold: 1, passed },
        reasons: passed
          ? ['all required fields present']
          : missing.map((m) => `required field missing: ${m}`),
        details: { missing, requiredCount: required.length, presentCount },
      };
    },
  };
}
