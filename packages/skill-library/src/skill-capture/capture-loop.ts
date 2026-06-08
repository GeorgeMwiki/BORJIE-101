/**
 * The Voyager skill-CAPTURE loop core.
 *
 *     solve → verify → describe → embed → store → compose
 *
 * `solve` already happened — the caller hands us a COMPLETED, VERIFIED
 * trajectory. This module runs the remaining five stages and returns a
 * permanent `CodeSkill` (registered into the live `VoyagerSkillLibrary`)
 * plus a `LearnedShortcut` to surface in the UI.
 *
 * Determinism: every effectful stage is injected (describer, embedder,
 * clock, id-gen). The library register/retrieve is reused as-is. Nothing
 * here executes a tool, touches money, or bypasses a rail — it only
 * records a parameterised description of work that ALREADY succeeded, and
 * marks it `human_reviewed: false` so it cannot auto-fire until a human
 * (four-eye) promotes it.
 *
 * @module @borjie/skill-library/skill-capture/capture-loop
 */

import type {
  CodeSkill,
  SerializableFunction,
} from '../voyager-library/types.js';
import { COMPOSITION_THRESHOLD } from '../voyager-library/types.js';
import { cosineSimilarity } from '../voyager-library/retrieval.js';
import type { VoyagerSkillLibrary } from '../voyager-library/library.js';
import {
  type CompletedTask,
  type CompletedTaskStep,
  type SkillCaptureResult,
  type SkillDescriber,
  type SkillEmbedder,
  type CaptureLogger,
  MIN_STEPS_FOR_CAPTURE,
} from './types.js';
import { toSkillSlug, suffixSlug } from './slug.js';
import { captureAuditHash, GENESIS_HASH } from './audit.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CaptureLoopOptions {
  /** Describe stage — NL summary of the capability. */
  readonly describer: SkillDescriber;
  /** Embed stage — vector for retrieval. */
  readonly embedder: SkillEmbedder;
  /** Live library the captured skill is stored into (and composed against). */
  readonly library: VoyagerSkillLibrary;
  /** Injectable clock for deterministic tests. Defaults to `Date`. */
  readonly now?: () => Date;
  /** Previous capture-event hash for the audit chain. Defaults to genesis. */
  readonly prevAuditHash?: string;
  /** Structured logger (Pino-shaped). Defaults to no-op. */
  readonly logger?: CaptureLogger;
}

// ---------------------------------------------------------------------------
// Param templatisation — reused contract from the kernel skill-compiler
// ---------------------------------------------------------------------------

/**
 * Replace any primitive arg leaf whose value matches a supplied param
 * value with `{{paramName}}`. Objects/arrays pass through (a reviewer
 * refines them). Immutable — returns a fresh object.
 */
function templatiseArgs(
  args: Readonly<Record<string, unknown>>,
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
  return value;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * Run describe → embed → store → compose over a verified trajectory.
 *
 * Pre-conditions (the completion hook checks `verified`/evidence before
 * calling, but this stays defensive):
 *   - >= MIN_STEPS_FOR_CAPTURE successful steps.
 *
 * Returns a discriminated result. On the describe/compile stages failing
 * it returns `captured: false` rather than throwing — capture is a
 * best-effort enrichment, never a task-blocker.
 */
export async function runCaptureLoop(
  task: CompletedTask,
  opts: CaptureLoopOptions,
): Promise<SkillCaptureResult> {
  const log = opts.logger ?? {};
  const now = opts.now ?? (() => new Date());

  const successfulSteps = task.steps.filter((s) => s.success === true);
  if (successfulSteps.length === 0) {
    return {
      captured: false,
      reason: 'no_successful_steps',
      detail: 'trajectory has no successful steps to learn from',
    };
  }
  if (successfulSteps.length < MIN_STEPS_FOR_CAPTURE) {
    return {
      captured: false,
      reason: 'too_few_steps',
      detail: `need >= ${MIN_STEPS_FOR_CAPTURE} successful steps, got ${successfulSteps.length}`,
    };
  }

  // ── describe ──────────────────────────────────────────────────────────
  let described: { name: string; description: string };
  try {
    described = await opts.describer({
      intent: task.intent,
      steps: successfulSteps,
      jurisdiction: task.jurisdiction,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn?.('[skill-capture] describer failed', { detail, cid: task.correlation_id });
    return { captured: false, reason: 'describe_failed', detail };
  }
  if (!described.name.trim() || !described.description.trim()) {
    return {
      captured: false,
      reason: 'describe_failed',
      detail: 'describer returned an empty name or description',
    };
  }

  // ── embed ─────────────────────────────────────────────────────────────
  const embedding = opts.embedder(described.description);
  if (embedding.length === 0) {
    return {
      captured: false,
      reason: 'compile_failed',
      detail: 'embedder returned an empty vector',
    };
  }

  // ── compose: is an existing skill close enough to extend? ──────────────
  const composedFrom = findCompositionBase(opts.library, embedding, task.jurisdiction);

  // ── store: build the parameterised CodeSkill + register ────────────────
  const paramKeyByValue = buildParamIndex(task.params);
  const code = buildSkillFunction(successfulSteps, paramKeyByValue, described.description);

  const baseSlug = toSkillSlug(described.name);
  const id = resolveFreeSlug(opts.library, baseSlug);

  const skill: CodeSkill = {
    id,
    name: described.name.trim(),
    description: described.description.trim(),
    embedding,
    jurisdiction: task.jurisdiction,
    code,
    last_used_at: now().toISOString(),
    success_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    quarantined: false,
  };

  try {
    opts.library.register(skill);
  } catch (error) {
    // register() throws only on a duplicate id; resolveFreeSlug should
    // prevent that, but stay defensive — a concurrent register is a
    // benign no-op for capture.
    const detail = error instanceof Error ? error.message : String(error);
    log.warn?.('[skill-capture] register failed', { detail, id, cid: task.correlation_id });
    return { captured: false, reason: 'duplicate', detail };
  }

  // ── audit: append-only capture-event hash ──────────────────────────────
  const auditPayload = {
    event: 'skill_captured',
    tenant_id: task.tenant_id,
    skill_id: id,
    jurisdiction: task.jurisdiction,
    intent: task.intent,
    step_count: successfulSteps.length,
    composed_from: composedFrom,
    evidence_ids: [...task.evidence_ids].sort(),
    correlation_id: task.correlation_id,
    captured_at: now().toISOString(),
    human_reviewed: false,
  } as const;
  const auditHash = captureAuditHash(auditPayload, opts.prevAuditHash ?? GENESIS_HASH);

  log.info?.('[skill-capture] captured new skill', {
    id,
    composed_from: composedFrom,
    cid: task.correlation_id,
  });

  return {
    captured: true,
    skill,
    shortcut: {
      id: `skill:${id}`,
      label: skill.name,
      // New skills start at a modest confidence; the chat-ui ranker
      // re-normalises against success_count over time.
      confidence: 0.5,
    },
    composed_from: composedFrom,
    audit_hash: auditHash,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** value → param-name index for templatisation (primitive values only). */
function buildParamIndex(
  params: Readonly<Record<string, string>> | undefined,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  if (!params) return index;
  for (const [paramKey, paramValue] of Object.entries(params)) {
    if (typeof paramValue !== 'string' || paramValue.length === 0) continue;
    // last-writer-wins is fine: param NAMES are the stable identity.
    index.set(paramValue, paramKey);
  }
  return index;
}

/**
 * Build the captured skill's executable body. A captured skill is a
 * REPLAY PLAN: it returns the templatised, ordered tool sequence as a
 * structured plan. It does NOT execute tools itself — execution stays the
 * orchestrator's job under the live rails. This keeps capture additive +
 * rail-safe: a captured skill can describe what to do, never silently do
 * it.
 */
function buildSkillFunction(
  steps: ReadonlyArray<CompletedTaskStep>,
  paramKeyByValue: ReadonlyMap<string, string>,
  description: string,
): SerializableFunction {
  const plan = steps.map((s) => ({
    tool: s.tool,
    args_template: templatiseArgs(s.args, paramKeyByValue),
  }));
  const planJson = JSON.stringify(plan);
  const source = `// Captured replay-plan skill (human-review-gated).\n// ${description}\nasync function run(_ctx, input) {\n  return { plan: ${planJson}, input };\n}`;
  return {
    source,
    input_schema: { type: 'object', additionalProperties: true },
    output_schema: {
      type: 'object',
      properties: {
        plan: { type: 'array' },
        input: { type: 'object' },
      },
    },
    // Pure: returns the plan + the runtime input. The orchestrator binds
    // `{{param}}` placeholders from `input` and executes each step under
    // the rails — capture never executes here.
    run: async (_ctx, input) => ({ plan, input }) as unknown,
  };
}

/**
 * The "compose" stage: if an EXISTING non-quarantined, jurisdiction-
 * compatible skill sits above COMPOSITION_THRESHOLD similarity to the new
 * capability, return its id so the capture is recorded as an EXTENSION of
 * prior procedural memory (Voyager's compose step). Returns `null` when
 * the capability is genuinely novel.
 */
function findCompositionBase(
  library: VoyagerSkillLibrary,
  embedding: ReadonlyArray<number>,
  jurisdiction: 'platform' | string,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const skill of library.all()) {
    if (skill.quarantined) continue;
    if (skill.jurisdiction !== 'platform' && skill.jurisdiction !== jurisdiction) {
      continue;
    }
    const score = cosineSimilarity(skill.embedding, embedding);
    if (score < COMPOSITION_THRESHOLD) continue;
    if (best === null || score > best.score) {
      best = { id: skill.id, score };
    }
  }
  return best === null ? null : best.id;
}

/**
 * Find a free slug deterministically. `register()` guards id collisions;
 * we pre-resolve so capture never throws on a name reuse.
 */
function resolveFreeSlug(library: VoyagerSkillLibrary, base: string): string {
  if (library.get(base) === undefined) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = suffixSlug(base, n);
    if (library.get(candidate) === undefined) return candidate;
  }
  // Astronomically unlikely; fall back to a time-tagged slug.
  return suffixSlug(base, Date.now() % 100000);
}
