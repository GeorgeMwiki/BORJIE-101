/**
 * Skill compiler — Voyager-pattern skill synthesis from successful traces.
 *
 * Given a session trace of (tool, args, success) tuples, the compiler
 * promotes the successful steps into a parameterised skill: a reusable
 * tool sequence + Zod schema for the runtime parameters. The compiled
 * skill is HUMAN-REVIEW-GATED — it lands in the registry with
 * `humanReviewed: false` so the four-eye gate has a chance to inspect
 * the auto-extraction before the orchestrator will invoke it.
 *
 * Two surfaces:
 *
 *   - `compileSkill(trace, name, params)` — Pure extraction. Walks the
 *     trace, keeps only successful steps, identifies which argument
 *     values came from the supplied `params` map, and templatises them
 *     as `{{paramName}}` placeholders.
 *
 *   - `autoSuggestSkill(intent, registry)` — At inference time, scan
 *     the registry for a skill whose `name` or canonical-tokens match
 *     the requested intent. Returns `null` for cold start; non-LLM
 *     so callers can pre-filter before paying for an embedding lookup.
 *
 * The compiler refuses to emit a skill if every step in the trace
 * failed — that's not a learnable pattern, it's a regression case.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SessionTraceStep {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly success: boolean;
}

export interface CompiledSkillStep {
  readonly tool: string;
  readonly argsTemplate: Record<string, unknown>;
}

export interface CompiledSkill {
  readonly id: string;
  readonly name: string;
  readonly paramSchema: z.ZodTypeAny;
  readonly toolSequence: ReadonlyArray<CompiledSkillStep>;
  readonly sourceSessionId: string;
  readonly compiledAt: string;
  readonly humanReviewed: boolean;
}

export interface CompileSkillOptions {
  /** Optional source-session identifier for audit / dedup. */
  readonly sourceSessionId?: string;
  /** Optional clock — tests inject a deterministic timestamp. */
  readonly now?: () => Date;
  /** Optional id generator — tests inject a deterministic id. */
  readonly idGen?: () => string;
}

export class SkillCompileError extends Error {
  constructor(public readonly issue: string) {
    super(`SkillCompile failed: ${issue}`);
    this.name = 'SkillCompileError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Compile
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract a parameterised skill from a session trace.
 *
 * Algorithm:
 *   1. Drop failed steps.
 *   2. If zero steps survive — throw. Failed traces aren't learnable.
 *   3. For each remaining step's args, walk the leaves and replace any
 *      value that exactly matches one of `params`' values with
 *      `{{paramName}}`. Parameter values must be primitive (string /
 *      number / boolean) for the matcher to fire — nested objects fall
 *      through unchanged.
 *   4. Build a Zod schema from the keys of `params`. Each param is
 *      typed as `z.string()` by default — the compiler doesn't infer
 *      richer types; the human reviewer is expected to tighten the
 *      schema before promotion.
 */
export function compileSkill(
  sessionTrace: ReadonlyArray<SessionTraceStep>,
  name: string,
  params: Record<string, string>,
  options: CompileSkillOptions = {},
): CompiledSkill {
  if (!Array.isArray(sessionTrace) || sessionTrace.length === 0) {
    throw new SkillCompileError('trace is empty');
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new SkillCompileError('name is required');
  }
  const successful = sessionTrace.filter((step) => step.success === true);
  if (successful.length === 0) {
    throw new SkillCompileError('no successful steps in trace');
  }

  const paramKeyByValue = new Map<string, string>();
  for (const [paramKey, paramValue] of Object.entries(params)) {
    if (typeof paramValue !== 'string') continue;
    paramKeyByValue.set(paramValue, paramKey);
  }

  const toolSequence: ReadonlyArray<CompiledSkillStep> = successful.map(
    (step) => ({
      tool: step.tool,
      argsTemplate: templatiseArgs(step.args, paramKeyByValue),
    }),
  );

  const schemaShape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(params)) {
    schemaShape[key] = z.string();
  }
  const paramSchema =
    Object.keys(schemaShape).length === 0
      ? z.object({}).strict()
      : z.object(schemaShape).strict();

  const now = options.now ?? (() => new Date());
  const idGen = options.idGen ?? defaultIdGen;

  return {
    id: idGen(),
    name: name.trim(),
    paramSchema,
    toolSequence,
    sourceSessionId: options.sourceSessionId ?? '',
    compiledAt: now().toISOString(),
    humanReviewed: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auto-suggest
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns a registered skill whose `name` tokens overlap the user's
 * intent. Pure token-overlap match — callers wire an embedding
 * retriever (skill-retriever.ts) for the semantic path. This is the
 * cheap pre-filter for the deterministic happy path.
 *
 * Cold-start: returns `null` for an empty registry.
 * Tie-break: highest overlap wins; ties resolved by earliest insertion.
 * Only returns reviewed skills — unreviewed compilations never auto-fire.
 */
export function autoSuggestSkill(
  intent: string,
  registry: ReadonlyArray<CompiledSkill>,
): CompiledSkill | null {
  if (!Array.isArray(registry) || registry.length === 0) return null;
  if (typeof intent !== 'string' || !intent.trim()) return null;

  const intentTokens = tokenise(intent);
  if (intentTokens.length === 0) return null;
  const intentSet = new Set(intentTokens);

  let best: { skill: CompiledSkill; score: number } | null = null;
  for (const skill of registry) {
    if (!skill.humanReviewed) continue;
    const skillTokens = tokenise(skill.name);
    let score = 0;
    for (const t of skillTokens) if (intentSet.has(t)) score += 1;
    if (score === 0) continue;
    if (best === null || score > best.score) {
      best = { skill, score };
    }
  }
  return best === null ? null : best.skill;
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function templatiseArgs(
  args: Record<string, unknown>,
  paramKeyByValue: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    next[k] = templatiseValue(v, paramKeyByValue);
  }
  return next;
}

function templatiseValue(
  value: unknown,
  paramKeyByValue: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') {
    const hit = paramKeyByValue.get(value);
    return hit !== undefined ? `{{${hit}}}` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    const hit = paramKeyByValue.get(String(value));
    return hit !== undefined ? `{{${hit}}}` : value;
  }
  if (value === null || value === undefined) return value;
  // Objects/arrays pass through unchanged — the reviewer can refine.
  return value;
}

function tokenise(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

let counter = 0;
function defaultIdGen(): string {
  counter += 1;
  const stamp = Date.now().toString(36);
  return `skill-${stamp}-${counter.toString(36)}`;
}
