/**
 * @borjie/module-spec-engine — Piece B DSL grammar + compiler.
 *
 * Public surface:
 *
 *   ModuleSpecSchema, ModuleSpec        — locked grammar (Zod)
 *   EntityDeclSchema, FieldDeclSchema   — sub-grammar pieces
 *   validateSpec(json)                  — Zod parse + cross-refs
 *   compileSpec(spec, tenantId)         — generate safe migration SQL
 *                                          + Zod validators
 *   previewMigration(spec, tenantId)    — dry-run helper
 *   diffCompileResults(before, after)   — coarse delta for K5 review
 *
 * The LLM (or any human authoring path) may emit only `ModuleSpec`-
 * shaped JSON. The compiler turns it into safe SQL — the LLM NEVER
 * emits SQL/JSX/DDL.
 */

export {
  ModuleSpecSchema,
  EntityDeclSchema,
  FieldDeclSchema,
  WorkflowDeclSchema,
  UiSectionDeclSchema,
  FIELD_KINDS,
  WORKFLOW_EVENTS,
  SLUG_REGEX,
  ENUM_VALUE_REGEX,
  MAX_ENTITIES_PER_SPEC,
  MAX_WORKFLOWS_PER_SPEC,
  MAX_UI_SECTIONS_PER_SPEC,
  MAX_FIELDS_PER_ENTITY,
  MAX_ENUM_VALUES,
  MAX_WORKFLOW_STEPS,
  type ModuleSpec,
  type EntityDecl,
  type FieldDecl,
  type FieldKind,
  type WorkflowDecl,
  type UiSectionDecl,
  type CompileResult,
  type ZodValidatorTree,
  type ZodFieldTree,
} from './types.js';

export { validateSpec, type ValidateResult } from './validate.js';

export { compileSpec } from './compile.js';

export {
  previewMigration,
  diffCompileResults,
  type DryRunResult,
  type SpecDiff,
} from './dry-run.js';
