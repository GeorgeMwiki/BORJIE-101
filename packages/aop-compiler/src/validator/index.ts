/**
 * Orchestrator that runs every validator in order. Stops at the first
 * grammar-level failure (schema) because the downstream validators assume a
 * structurally-valid AST.
 */

import type {
  AOP,
  BrainToolRegistry,
  ValidationError,
  ValidationResult,
} from '../types.js';
import { validateSchema } from './schema-validator.js';
import { validateTools } from './tool-validator.js';
import { validateInvariants } from './invariant-validator.js';
import { validatePermissions } from './permission-validator.js';

export function validate(
  ast: AOP,
  registry: BrainToolRegistry,
): ValidationResult {
  const schema = validateSchema(ast);
  if (!schema.ok) return schema;

  const errors: ValidationError[] = [
    ...validateInvariants(ast).errors,
    ...validateTools(ast, registry).errors,
    ...validatePermissions(ast, registry).errors,
  ];

  return { ok: errors.length === 0, errors };
}

export { validateSchema } from './schema-validator.js';
export { validateTools } from './tool-validator.js';
export { validateInvariants } from './invariant-validator.js';
export { validatePermissions } from './permission-validator.js';
