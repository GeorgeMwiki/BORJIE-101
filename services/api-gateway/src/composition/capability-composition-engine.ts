/**
 * Capability-Composition Engine — the brain's Tier-2 self-architect.
 *
 * Given a novel need that cleared the hard rails (the generative
 * `deferToBrain` branch in `chat-actions.hono.ts`), the engine:
 *
 *   1. GOAL — builds a goal string from verb + params + rationale.
 *   2. SEARCH — runs `latsSearch` with LLM-backed expander/evaluator that
 *      enumerate + score COMPOSITIONS of the registry's power-tools. The
 *      expander proposes the next tool-call (as a JSON line) from
 *      `registry.list()`; the evaluator scores how well the partial chain
 *      serves the need.
 *   3. PLAN — if `bestScore >= MIN_WINNING_SCORE` AND the winning path maps
 *      to a valid `ComposeArgs`, materialises that compose chain.
 *   4. GOVERNANCE — runs EACH step's (toolId→verb) through the injected
 *      `decideAutoAuthorization` gate. If ANY step is not authorized
 *      (gate / four_eyes / deny), it does NOT auto-execute → returns null.
 *   5. EXECUTE — invokes `registry.invoke('compose', composeArgs, ctx)`
 *      transactionally. The compose tool's own compensation/rollback stays
 *      intact; a partial failure rolls back.
 *
 * FAIL-SAFE: `attempt` NEVER throws. Every failure path resolves to `null`,
 * which the route reads as "fall through to the unchanged deferToBrain
 * return". The whole body is wrapped in a try/catch as defence-in-depth.
 *
 * @module composition/capability-composition-engine
 */

import { orchestrator, powerTools } from '@borjie/central-intelligence';

const { latsSearch, LATS_DEFAULT_MAX_ITERATIONS } = orchestrator;

type AnyPowerTool = powerTools.AnyPowerTool;
type ComposeArgs = powerTools.ComposeArgs;
type ComposeOutput = powerTools.ComposeOutput;
type ComposeStep = powerTools.ComposeStep;
type Evaluator = orchestrator.Evaluator;
type Expander = orchestrator.Expander;
type LatsResult = orchestrator.LatsResult;
type PlanContext = orchestrator.PlanContext;
type PowerToolRegistry = powerTools.PowerToolRegistry;
type PowerToolResult<O> = powerTools.PowerToolResult<O>;
type Thought = orchestrator.Thought;

import type {
  CapabilityCompositionEngine,
  CompositionAttemptInput,
  CompositionModelPort,
  ComposedResult,
  PlannedComposition,
  StepGovernanceGate,
} from './capability-composition-types.js';

// ─────────────────────────────────────────────────────────────────────
// Tuning constants (conservative — bias toward NOT auto-acting).
// ─────────────────────────────────────────────────────────────────────

/**
 * A composition wins only when the best leaf scores at or above this. Set
 * high: the engine should auto-act ONLY when it is confident the chain
 * genuinely serves the need; otherwise it defers to a full brain turn.
 */
const MIN_WINNING_SCORE = 0.7;

/** Max steps we will ever materialise into a compose chain (compose caps 20). */
const MAX_COMPOSITION_STEPS = 8;

/**
 * Engine-built compositions auto-execute ONLY as a single atomically-safe
 * step until per-step `compensate` synthesis exists — a multi-step chain whose
 * steps lack compensations could leave committed side effects on a mid-chain
 * failure (compose's reverse-walk is a no-op without `compensate`, because
 * `tracePlannedSteps` never sets it). Multi-step transactional composition is
 * a tracked follow-up. `MAX_COMPOSITION_STEPS` stays the compose HARD ceiling;
 * `MAX_AUTO_EXECUTE_STEPS` is the EXECUTABLE cap.
 */
const MAX_AUTO_EXECUTE_STEPS = 1;

/** Search iteration budget — small; this is a fast pre-flight, not a full plan. */
const SEARCH_MAX_ITERATIONS = Math.min(8, LATS_DEFAULT_MAX_ITERATIONS);

/** Branching factor — how many candidate next tool-calls the expander proposes. */
const SEARCH_BRANCHING = 3;

/** Token budget for the whole search — caps cost so a slow model can't stall. */
const SEARCH_BUDGET_TOKENS = 6_000;

/** Per-oracle-call output cap. */
const ORACLE_MAX_TOKENS = 512;

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export interface CreateCapabilityCompositionEngineDeps {
  /** The text-in/text-out model port (kernel's wrapped Anthropic client). */
  readonly model: CompositionModelPort;
  /** The power-tool registry the compositions run against. */
  readonly registry: PowerToolRegistry;
  /** Per-step governance gate (bound to `decideAutoAuthorization`). */
  readonly governanceGate: StepGovernanceGate;
  /** Structured logger (pino-like). */
  readonly logger: {
    info(meta: object, message?: string): void;
    warn(meta: object, message?: string): void;
    error(meta: object, message?: string): void;
  };
}

/**
 * Build the engine. Pure construction — never touches the network or env.
 * The returned `attempt` is the only public surface.
 */
export function createCapabilityCompositionEngine(
  deps: CreateCapabilityCompositionEngineDeps,
): CapabilityCompositionEngine {
  const { model, registry, governanceGate, logger } = deps;

  async function attempt(
    input: CompositionAttemptInput,
  ): Promise<ComposedResult | null> {
    try {
      // The candidate tool inventory — the tools the caller's tier can run.
      // `compose` itself is excluded as a STEP (it is the outer container,
      // never an inner step), but stays the dispatch entry point.
      const inventory = registry
        .listForTier(input.ctx.tier)
        .filter((t) => t.id !== 'compose');
      if (inventory.length === 0) {
        return null;
      }

      // CHEAP, LLM-FREE EARLY-OUT. Before spending a full LATS + LLM search,
      // pre-flight EVERY candidate tool through the SAME fail-closed governance
      // gate. A tool is auto-clearable only when the gate authorizes it AND the
      // autonomy controller lands on `auto`. If NOTHING is auto-clearable, no
      // composition could ever auto-execute (allStepsAuthorized would reject
      // it), so we skip the expensive search entirely and defer to the brain.
      const autoClearable = inventory.filter((t) =>
        isAutoClearable(t, input, governanceGate),
      );
      if (autoClearable.length === 0) {
        logger.info(
          { verb: input.verb, inventory: inventory.length },
          'capability-composition: no auto-clearable power-tool; skipping composition search',
        );
        return null;
      }

      const goal = buildGoal(input);
      // Search ONLY over tools that can actually auto-execute — behaviour-
      // preserving (a non-auto tool would have been refused by the membrane).
      const planned = await planComposition({ goal, inventory: autoClearable, model });
      if (!planned) {
        return null;
      }
      // SINGLE-STEP CAP. Until per-step `compensate` synthesis exists the
      // engine refuses to auto-execute a multi-step chain (no partial-failure
      // residue window). A multi-step winner is deferred to the brain.
      if (planned.composeArgs.steps.length !== MAX_AUTO_EXECUTE_STEPS) {
        logger.info(
          {
            verb: input.verb,
            steps: planned.composeArgs.steps.length,
            cap: MAX_AUTO_EXECUTE_STEPS,
          },
          'capability-composition: multi-step winner refused (single-step cap) — deferring to brain',
        );
        return null;
      }
      if (planned.score < MIN_WINNING_SCORE) {
        logger.info(
          { verb: input.verb, score: planned.score, threshold: MIN_WINNING_SCORE },
          'capability-composition: no winning composition (below threshold)',
        );
        return null;
      }

      // GOVERNANCE MEMBRANE — gate EVERY step before executing anything. The
      // tool-spec map lets the membrane derive the `sovereign:`-prefixed verb
      // from each step's SPEC (fail-closed), not a hardcoded name set.
      const toolsById = new Map(autoClearable.map((t) => [t.id, t]));
      if (!allStepsAuthorized(planned.composeArgs, input, governanceGate, logger, toolsById)) {
        return null;
      }

      // EXECUTE transactionally. The compose tool rolls back on mid-chain
      // failure via its compensations.
      const result = (await registry.invoke<ComposeOutput>(
        'compose',
        planned.composeArgs,
        input.ctx,
      )) as PowerToolResult<ComposeOutput>;

      if (result.kind !== 'ok') {
        logger.info(
          {
            verb: input.verb,
            kind: result.kind,
            message: 'message' in result ? result.message : null,
          },
          'capability-composition: compose did not commit — deferring to brain',
        );
        return null;
      }

      logger.info(
        { verb: input.verb, score: planned.score, steps: planned.composeArgs.steps.length },
        'capability-composition: composition executed and committed',
      );
      return {
        kind: 'composed',
        goal,
        score: planned.score,
        stepCount: result.output.stepCount,
        steps: planned.composeArgs.steps.map((s) => ({ toolId: s.toolId })),
        compose: result.output,
      };
    } catch (err) {
      // FAIL-SAFE: any throw → null → the route falls through to deferToBrain.
      logger.error(
        {
          verb: input.verb,
          error: err instanceof Error ? err.message : String(err),
        },
        'capability-composition: attempt threw — falling through to brain (fail-safe)',
      );
      return null;
    }
  }

  return { attempt };
}

// ─────────────────────────────────────────────────────────────────────
// Planning — LATS over power-tool compositions.
// ─────────────────────────────────────────────────────────────────────

async function planComposition(args: {
  readonly goal: string;
  readonly inventory: ReadonlyArray<AnyPowerTool>;
  readonly model: CompositionModelPort;
}): Promise<PlannedComposition | null> {
  const { goal, inventory, model } = args;
  const expander = buildCompositionExpander(inventory, model);
  const evaluator = buildCompositionEvaluator(model);

  let result: LatsResult;
  try {
    result = await latsSearch(goal, {
      expander,
      evaluator,
      maxIterations: SEARCH_MAX_ITERATIONS,
      // Bound the search depth to the EXECUTABLE cap — the engine refuses any
      // multi-step winner until per-step `compensate` synthesis exists, so
      // searching deeper would only waste budget on chains we cannot run.
      maxDepth: MAX_AUTO_EXECUTE_STEPS,
      branchingFactor: SEARCH_BRANCHING,
      budgetTokens: SEARCH_BUDGET_TOKENS,
      earlyExitScore: 0.95,
    });
  } catch {
    // Search itself faulted — defer.
    return null;
  }

  const steps = tracePlannedSteps(result, inventory);
  if (steps.length === 0) {
    return null;
  }
  const composeArgs: ComposeArgs = { steps };
  return { goal, score: result.bestScore, composeArgs };
}

/**
 * Walk the winning path (root → best leaf) and materialise each non-root
 * node's parsed tool-call into a `ComposeStep`. Nodes whose content does not
 * parse to a known, registry-resident tool are dropped (the chain only ever
 * carries valid steps). Returns `[]` when nothing parses.
 */
function tracePlannedSteps(
  result: LatsResult,
  inventory: ReadonlyArray<AnyPowerTool>,
): ComposeStep[] {
  const known = new Set(inventory.map((t) => t.id));
  const steps: ComposeStep[] = [];
  let seq = 0;
  // bestPath[0] is the root (the goal itself) — skip it.
  for (let i = 1; i < result.bestPath.length; i += 1) {
    const nodeId = result.bestPath[i];
    if (nodeId === undefined) continue;
    const node = result.nodesById.get(nodeId);
    if (!node || node.failed) continue;
    const call = parseToolCall(node.thought.content);
    if (!call || !known.has(call.toolId)) continue;
    seq += 1;
    steps.push({
      id: `step_${seq}`,
      toolId: call.toolId,
      args: call.args,
    });
    if (steps.length >= MAX_COMPOSITION_STEPS) break;
  }
  return steps;
}

// ─────────────────────────────────────────────────────────────────────
// Oracles — LLM-backed expander + evaluator over the registry.
// ─────────────────────────────────────────────────────────────────────

/**
 * The expander asks the model to propose the next power-tool call that
 * advances the partial composition toward the goal. The response is parsed
 * as one JSON tool-call per line; only calls naming a registry-resident tool
 * survive. On any model throw → `[]` (LATS treats it as a dead branch).
 */
export function buildCompositionExpander(
  inventory: ReadonlyArray<AnyPowerTool>,
  model: CompositionModelPort,
): Expander {
  const catalogue = inventory
    .map((t) => `- ${t.id} (tier ${t.requiredTier}): ${t.description}`)
    .join('\n');
  const toolIds = inventory.map((t) => t.id);

  return async (thought: Thought, k: number): Promise<Thought[]> => {
    let raw: string;
    try {
      raw = await model.complete({
        system: EXPANDER_SYSTEM,
        user: buildExpanderUser({ catalogue, thought, k }),
        maxTokens: ORACLE_MAX_TOKENS,
      });
    } catch {
      return [];
    }
    return parseExpanderLines(raw, thought, k, toolIds);
  };
}

/**
 * The evaluator scores (0..1) how well the partial composition ending at
 * `thought` serves the goal. On model throw → throw is caught by LATS'
 * `safeEvaluate` (returns null → node marked failed), so we surface failures
 * by re-throwing only when the model itself throws; a malformed score → 0.
 */
export function buildCompositionEvaluator(
  model: CompositionModelPort,
): Evaluator {
  return async (thought: Thought, context: PlanContext): Promise<number> => {
    const raw = await model.complete({
      system: EVALUATOR_SYSTEM,
      user: buildEvaluatorUser(thought, context),
      maxTokens: 16,
    });
    return parseScore(raw);
  };
}

// ─────────────────────────────────────────────────────────────────────
// Governance — gate EVERY composed step (the inhibition membrane).
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns true only when EVERY step authorizes (autonomy controller landed
 * on `auto`). A single `gate` / `four_eyes` / deny → false → the engine does
 * NOT auto-execute the composition. This re-uses the SAME fail-closed gate
 * the route runs for known verbs, so a composed power-tool step can never
 * free-run past a control a direct call would have hit.
 *
 * The verb each step is scored on is derived from the step's TOOL SPEC (looked
 * up in `toolsById`), not the toolId alone — a HIGH-consequence tool maps to a
 * `sovereign:`-prefixed verb. A step whose toolId is NOT in the spec map is
 * treated as high-consequence and refuses the whole composition (fail-closed:
 * we cannot reason about a tool we cannot see).
 */
function allStepsAuthorized(
  composeArgs: ComposeArgs,
  input: CompositionAttemptInput,
  gate: StepGovernanceGate,
  logger: CreateCapabilityCompositionEngineDeps['logger'],
  toolsById: ReadonlyMap<string, AnyPowerTool>,
): boolean {
  for (const step of composeArgs.steps) {
    const tool = toolsById.get(step.toolId);
    if (!tool) {
      // Unknown tool in a planned step → fail closed. The membrane refuses to
      // authorize a step whose spec it cannot inspect.
      logger.warn(
        { parentVerb: input.verb, toolId: step.toolId },
        'capability-composition: planned step references a tool absent from the inventory — refusing composition (fail-closed)',
      );
      return false;
    }
    const verb = stepVerb(tool);
    let decision: ReturnType<StepGovernanceGate>;
    try {
      decision = gate({
        verb,
        rationale: `composition:${input.verb}:${step.toolId}`,
        scope: input.scope,
      });
    } catch {
      // Gate threw — fail closed (treat as deny).
      logger.warn(
        { verb, toolId: step.toolId },
        'capability-composition: governance gate threw — refusing composition (fail-closed)',
      );
      return false;
    }
    if (!decision.authorized || decision.autonomyDecision !== 'auto') {
      logger.info(
        {
          parentVerb: input.verb,
          stepVerb: verb,
          toolId: step.toolId,
          reason: decision.reason,
          autonomyDecision: decision.autonomyDecision ?? null,
        },
        'capability-composition: a composed step is not auto-authorized — refusing composition',
      );
      return false;
    }
  }
  return true;
}

/**
 * Cheap, LLM-free pre-flight: would this single tool, run on its own, clear
 * the governance membrane to `auto`? Uses the SAME spec-derived verb mapping
 * and the SAME fail-closed gate `allStepsAuthorized` uses, so a tool the
 * membrane would later reject is filtered out BEFORE the search. A gate throw
 * → not auto-clearable (fail-closed).
 */
function isAutoClearable(
  tool: AnyPowerTool,
  input: CompositionAttemptInput,
  gate: StepGovernanceGate,
): boolean {
  try {
    const decision = gate({
      verb: stepVerb(tool),
      rationale: `composition-preflight:${input.verb}:${tool.id}`,
      scope: input.scope,
    });
    return decision.authorized && decision.autonomyDecision === 'auto';
  } catch {
    return false;
  }
}

/**
 * The highest tier a tool may require while still being eligible to AUTO-
 * execute. Anything above this is sovereign-grade by construction.
 */
const AUTO_EXECUTABLE_TIER_CEILING: powerTools.PowerToolTier = 'estate-manager';

/**
 * Belt-and-suspenders name set: tools historically known to be HIGH-
 * consequence / irreversible. This is an ADDITIONAL union ON TOP OF the
 * primary spec-derived check (`isHighConsequence`) — never the sole gate, so
 * a future high-consequence tool that is not in this set still fails closed
 * via its spec.
 */
const HIGH_CONSEQUENCE_TOOLS: ReadonlySet<string> = new Set([
  'cross_tenant',
  'self_modification',
]);

/**
 * Derive high-consequence status from the TOOL SPEC (fail-CLOSED), not a
 * hardcoded name allowlist. A tool is high-consequence when ANY of:
 *   - it requires four-eye approval (`requiresApproval`), OR
 *   - it writes to the sovereign-action ledger
 *     (`auditDestination === 'sovereign-action-ledger'`), OR
 *   - it requires a tier ABOVE the auto-executable ceiling, OR
 *   - it is in the legacy name set (belt-and-suspenders).
 * Any NEW high-consequence power-tool is therefore caught by its spec without
 * editing this file — the previous name-only set fail-OPENED for such tools.
 */
function isHighConsequence(tool: AnyPowerTool): boolean {
  return (
    tool.requiresApproval === true ||
    tool.auditDestination === 'sovereign-action-ledger' ||
    !powerTools.meetsTier(AUTO_EXECUTABLE_TIER_CEILING, tool.requiredTier) ||
    HIGH_CONSEQUENCE_TOOLS.has(tool.id)
  );
}

/**
 * Map a power-tool SPEC to the verb form the autonomy gate scores. Benign
 * tools namespace under `power_tool.` (scored on confidence×consequence).
 * HIGH-consequence tools namespace under `sovereign:` so they hit the literal
 * HIGH-risk prefix surface → `four_eyes` → never auto-executed.
 */
function stepVerb(tool: AnyPowerTool): string {
  return isHighConsequence(tool)
    ? `sovereign:power_tool.${tool.id}`
    : `power_tool.${tool.id}`;
}

// ─────────────────────────────────────────────────────────────────────
// Goal + parsing helpers (pure).
// ─────────────────────────────────────────────────────────────────────

function buildGoal(input: CompositionAttemptInput): string {
  const params = safeJson(input.params);
  return [
    `Fulfill the brain-generated action "${input.verb}".`,
    input.rationale ? `Rationale: ${input.rationale}.` : '',
    `Parameters: ${params}.`,
    'Compose a minimal, reversible chain of the available power-tools that',
    'accomplishes this. Prefer the fewest steps; never include a step whose',
    'effect cannot be compensated.',
  ]
    .filter((s) => s.length > 0)
    .join(' ');
}

interface ParsedToolCall {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

/**
 * Parse one expander line into a tool-call. Accepts a JSON object with a
 * `toolId` (or `tool`) string and an optional `args` object. Returns null on
 * anything malformed — the caller drops non-parsing nodes.
 */
function parseToolCall(content: string): ParsedToolCall | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const toolId =
    typeof obj.toolId === 'string'
      ? obj.toolId
      : typeof obj.tool === 'string'
        ? obj.tool
        : null;
  if (!toolId || toolId.trim().length === 0) return null;
  const args =
    typeof obj.args === 'object' && obj.args !== null
      ? (obj.args as Record<string, unknown>)
      : {};
  return { toolId: toolId.trim(), args };
}

/**
 * Parse the expander's multi-line response into normalised child thoughts.
 * Each line that parses to a known tool-call becomes one child carrying the
 * canonical re-serialised JSON (so downstream parsing is stable).
 */
function parseExpanderLines(
  raw: string,
  parent: Thought,
  k: number,
  toolIds: ReadonlyArray<string>,
): Thought[] {
  const known = new Set(toolIds);
  const out: Thought[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const stripped = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, '').trim();
    if (stripped.length === 0) continue;
    const call = parseToolCall(stripped);
    if (!call || !known.has(call.toolId)) continue;
    out.push({
      id: 'placeholder',
      content: JSON.stringify({ toolId: call.toolId, args: call.args }),
      depth: parent.depth + 1,
      parentId: parent.id,
      score: 0,
      explored: false,
    });
    if (out.length >= k) break;
  }
  return out;
}

/** Parse a bare 0..1 (or 0..100) score from model text. NaN → 0. */
function parseScore(raw: string): number {
  const match = raw.match(/-?\d+(?:\.\d+)?/u);
  if (!match) return 0;
  const n = Number(match[0]);
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 800 ? `${s.slice(0, 797)}...` : s;
  } catch {
    return '{}';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Prompt templates.
// ─────────────────────────────────────────────────────────────────────

const EXPANDER_SYSTEM = [
  'You are the Capability-Composition planner for a mining-estate operating',
  'system. You compose the brain\'s own meta-capabilities ("power-tools") into',
  'a transactional chain that fulfills a novel need. You NEVER invent tools —',
  'you may only use the tools in the supplied catalogue. You prefer the fewest,',
  'most reversible steps. You output ONLY tool-call lines, no prose.',
].join(' ');

function buildExpanderUser(args: {
  readonly catalogue: string;
  readonly thought: Thought;
  readonly k: number;
}): string {
  return [
    'Available power-tools:',
    args.catalogue,
    '',
    `Current partial composition (depth ${args.thought.depth}):`,
    args.thought.content,
    '',
    `Propose up to ${args.k} distinct NEXT power-tool calls that advance toward`,
    'the goal. Output ONE JSON object per line, each shaped exactly:',
    '{"toolId":"<one of the catalogue ids>","args":{...}}',
    'No commentary, no numbering, no code fences. If no further step helps,',
    'output nothing.',
  ].join('\n');
}

const EVALUATOR_SYSTEM = [
  'You are the Capability-Composition evaluator. You score how well a partial',
  'composition of power-tools serves the goal. Reply with ONE number from 0 to',
  '1 (1 = fully serves the goal, 0 = irrelevant or harmful). Output only the',
  'number.',
].join(' ');

function buildEvaluatorUser(thought: Thought, context: PlanContext): string {
  return [
    `Goal: ${context.goal}`,
    '',
    `Candidate step / partial composition: ${thought.content}`,
    '',
    'Score 0..1:',
  ].join('\n');
}
