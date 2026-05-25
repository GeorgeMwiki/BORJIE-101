/**
 * @borjie/approval-matrix-dsl — Piece E of the BORJIE master plan.
 *
 * The approval-matrix DSL provides a small declarative grammar for K5
 * routing rules. Three surfaces:
 *
 *   grammar    — Zod schemas + step-kind / power-tier enums
 *   parser     — Human-authored text → ParsedRule
 *   compiler   — ParsedRule + options → CompiledRule (the persistence shape)
 *   evaluator  — ActionStep + rules → required-role-group + quorum
 *
 * The evaluator is pure — no DB access — so it composes cleanly into the
 * action-runtime saga.
 */

export {
  STEP_KINDS,
  StepKindSchema,
  POWER_TIERS,
  PowerTierSchema,
  AMOUNT_OPS,
  AmountOpSchema,
  AmountCmpSchema,
  CompiledPredicateSchema,
  CompiledRuleSchema,
  MICRO_FACTOR,
  toMicros,
  fromMicros,
} from './grammar.js';
export type {
  StepKind,
  PowerTier,
  AmountOp,
  AmountCmp,
  CompiledPredicate,
  CompiledRule,
} from './grammar.js';

export {
  parseRule,
  ApprovalMatrixDslParseError,
} from './parser.js';
export type { ParsedRule } from './parser.js';

export {
  compileParsedRule,
  compileDsl,
  renderCompiledRule,
  ApprovalMatrixDslCompileError,
} from './compiler.js';
export type { CompileOptions } from './compiler.js';

export { evaluate } from './evaluator.js';
export type {
  EvaluationActionStep,
  EvaluationResult,
  EvaluatorOutcome,
  NoMatchResult,
} from './evaluator.js';
