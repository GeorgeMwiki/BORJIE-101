/**
 * Schema validation wrapper. Re-runs the Zod grammar against an in-memory AST
 * (e.g. one we just parsed from a YAML fixture) so callers don't have to know
 * about Zod directly.
 */

import type { ValidationError, ValidationResult } from '../types.js';
import { AOPSchema } from '../parser/grammar.js';

export function validateSchema(ast: unknown): ValidationResult {
  const parsed = AOPSchema.safeParse(ast);
  if (parsed.success) return { ok: true, errors: [] };

  const errors: ValidationError[] = parsed.error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path,
  }));

  return { ok: false, errors };
}
