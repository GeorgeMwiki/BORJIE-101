/**
 * aop-wiring.ts — un-darks the AOP (Agent Operating Procedure)
 * meta-learning loop (R8).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `createAOPRegistry` / `createAOPRunner` / `createRegressionRunner` /
 * `createAOPCanaryBridge` (packages/central-intelligence/src/agent/aops/)
 * ship the full Decagon-style closed loop — versioned NL operating
 * procedures, regression-gated promotion, canary stage ladder with
 * auto-rollback — exported + unit-tested but with ZERO production
 * callers. The Drizzle store (`aop_specs` / `aop_regression_sets` /
 * `aop_active_versions`, wired in persistent-stores-wiring.ts) persisted
 * rows nobody ever read back into a running loop. This module composes
 * the factories over that store and drives them on the established
 * leader-gated cron seam:
 *
 *   OBSERVE   registry.refresh() re-hydrates from the persisted store;
 *             a CANDIDATE is the newest registered version of an AOP id
 *             that is not the active version (including brand-new ids
 *             with no active version yet).
 *   PROPOSE   an un-enrolled candidate is enrolled at `shadow` on the
 *             canary controller (zero traffic) — never re-enrolled, so
 *             climbing progress is never silently reset.
 *   REGRESSION the candidate's RegressionSet is replayed through
 *             `createRegressionRunner` over `createAOPRunner` with a
 *             budget-guarded Anthropic executor; the report carries the
 *             raw pass-rate.
 *   CANARY    `bridge.promote()` gates ONE rung per tick on a FRESH
 *             regression report (shadow → 1% → 5% → 25% → live takes
 *             ≥4 passing ticks). Reaching `live` atomically flips the
 *             registry's active version — THE factories' own gate, not
 *             a parallel mechanism. A gate failure above `shadow`
 *             triggers `bridge.rollback()` (one-rung demotion — the
 *             quality-drift contract).
 *
 * HARD RAILS
 * ----------
 *   - PROPOSE-ONLY PAST THE GATE. Nothing activates without a fresh
 *     passing regression report walked through the canary ladder. No
 *     report ⇒ no promotion (fail-closed): a missing regression set or
 *     an unconfigured Anthropic key HOLDS the candidate at its current
 *     stage and logs honestly — it never fakes a pass.
 *   - REGRESSION REPLAY IS TEXT-ONLY. The executor drives the AOP's
 *     system prompt against the historical user message but NEVER
 *     executes live tools from this cron — a regression replay must not
 *     mutate estate state. Transcripts whose expected signals require
 *     real tool calls therefore fail CLOSED (no promotion), never open.
 *   - FAIL-SAFE TICK. Every step is try/caught; a fault increments a
 *     counter and is logged via the Pino-shape logger — it never crashes
 *     boot, a request, or the interval. The timer is `unref()`-ed.
 *   - KILL-SWITCH. `BORJIE_AOP_META_LOOP=off|0|false|no` disables the
 *     loop (DEFAULT-ON, matching the un-darking precedent); the loop is
 *     also inert under NODE_ENV=test unless a test passes `enabled`.
 *   - BUDGET-GOVERNED COMPUTE. Every LLM call goes through the
 *     composition root's budget-guarded Anthropic factory under the
 *     platform tenant scope, so regression replay can never blow past
 *     the cost ceiling.
 *   - CONSERVATIVE RESTART. Canary stages live in-process (no persisted
 *     stage table exists); a restart resets candidates to un-enrolled,
 *     so they re-enrol at `shadow` and must RE-PROVE the full ladder.
 *     The activation flip itself IS persisted (`aop_active_versions`).
 */

import {
  createAOPCanaryBridge,
  createAOPRegistry,
  createAOPRunner,
  createRegressionRunner,
  type AOPCanaryAdapter,
  type AOPCanaryBridge,
  type AOPCanaryStage,
  type AOPExecutor,
  type AOPRegistry,
  type AOPRegistryStore,
  type AOPSpec,
  type RegressionRunner,
} from '@borjie/central-intelligence/aops';
import {
  demoteStage as governanceDemoteStage,
  promoteStage as governancePromoteStage,
} from '@borjie/autonomy-governance';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// Tunables — clamped so a bad env can never push the cadence out of band.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5-minute floor
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ceiling

/** The canary bridge's own default; redeclared so the boot log names it. */
const DEFAULT_MIN_REGRESSION_PASS_RATE = 0.9;
/** Hard cap on candidates regression-replayed per tick (LLM-spend bound). */
const DEFAULT_MAX_CANDIDATES_PER_TICK = 5;
/** Output-token ceiling per regression call (cost rail). */
const MAX_OUTPUT_TOKENS_CAP = 4096;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/** DEFAULT-ON kill-switch (only off/0/false/no disables). */
export const AOP_META_LOOP_KILL_SWITCH_ENV = 'BORJIE_AOP_META_LOOP';

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

function killSwitchOff(env: Readonly<Record<string, string | undefined>>): boolean {
  const v = (env[AOP_META_LOOP_KILL_SWITCH_ENV] ?? '').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'no';
}

// ─────────────────────────────────────────────────────────────────────
// Anthropic AOP executor — the wire-level adapter the runner abstracts.
//
// Drives the AOP's system prompt against the regression transcript's
// user message through the budget-guarded client. TEXT-ONLY: tool names
// in the spec are NOT resolved/executed here (a cron-side regression
// replay must never mutate estate state), so `toolCalls` is always
// empty and tool-dependent expected signals fail closed.
// ─────────────────────────────────────────────────────────────────────

/** Structural twin of `BudgetGuardedAnthropicClient` (@borjie/ai-copilot). */
export interface AopAnthropicClientLike {
  readonly defaultModel: string;
  readonly sdk: {
    messages: {
      create(request: {
        model: string;
        max_tokens: number;
        temperature?: number;
        system?: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  };
}

export interface CreateAnthropicAopExecutorArgs {
  /**
   * Per-tenant budget-guarded Anthropic factory from the composition
   * root. Null when no Anthropic key is configured → null executor →
   * the loop holds every candidate at its current stage (fail-closed).
   */
  readonly buildBudgetGuardedAnthropicClient:
    | ((tenantId: string, operation?: string) => AopAnthropicClientLike)
    | null;
  /** Budget scope for platform-global AOP regression runs. */
  readonly platformTenantId?: string;
}

/**
 * Build the production `AOPExecutor`, or null when no Anthropic factory
 * is available. Validates `spec.model.provider` at wire time (the
 * aop-spec contract) — a non-anthropic descriptor throws, which the
 * runner converts into an honest failed trace (never a fake pass).
 */
export function createAnthropicAopExecutor(
  args: CreateAnthropicAopExecutorArgs,
): AOPExecutor | null {
  const factory = args.buildBudgetGuardedAnthropicClient;
  if (!factory) return null;
  const platformTenantId = args.platformTenantId ?? '_platform';

  return {
    async execute(spec, request) {
      if (spec.model.provider !== 'anthropic') {
        throw new Error(
          `aop-executor: unsupported provider '${spec.model.provider}' for ${spec.id}@${spec.version} (anthropic only)`,
        );
      }
      const client = factory(platformTenantId, 'aop-regression');
      const maxTokens = Math.min(
        MAX_OUTPUT_TOKENS_CAP,
        spec.model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      );
      const response = await client.sdk.messages.create({
        model: spec.model.name || client.defaultModel,
        max_tokens: maxTokens,
        ...(spec.model.temperature !== undefined
          ? { temperature: spec.model.temperature }
          : {}),
        system: spec.systemPrompt,
        messages: [{ role: 'user', content: request.userMessage }],
      });
      const finalOutput = (response.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n');
      // TEXT-ONLY replay rail: no live tool execution from this cron.
      return Object.freeze({ finalOutput, toolCalls: Object.freeze([]) });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Canary adapter — the bridge's port, wired to autonomy-governance's
// REAL `promoteStage` / `demoteStage` stage math (the exact wiring the
// canary-bridge header prescribes). Stage state is in-process: a restart
// resets candidates to un-enrolled, which is CONSERVATIVE — they re-enrol
// at `shadow` and must re-prove the ladder, regression-gated per rung.
// ─────────────────────────────────────────────────────────────────────

export function createInProcessCanaryAdapter(): AOPCanaryAdapter {
  const stages = new Map<string, AOPCanaryStage>();
  const key = (aopId: string, version: string): string => `${aopId}@${version}`;

  return {
    async getStage(aopId, version) {
      return stages.get(key(aopId, version)) ?? null;
    },
    async promoteStage(aopId, version) {
      const current = stages.get(key(aopId, version));
      if (!current) {
        throw new Error(`aop-canary: (${aopId}, ${version}) is not enrolled`);
      }
      const next = governancePromoteStage(current);
      if (next === null) {
        throw new Error(`aop-canary: (${aopId}, ${version}) already at live`);
      }
      stages.set(key(aopId, version), next);
      return next;
    },
    async demoteStage(aopId, version) {
      const current = stages.get(key(aopId, version));
      if (!current) return null;
      const prev = governanceDemoteStage(current);
      if (prev === null) return null;
      stages.set(key(aopId, version), prev);
      return prev;
    },
    async enrol(aopId, version) {
      stages.set(key(aopId, version), 'shadow');
    },
    async retire(aopId, version) {
      stages.delete(key(aopId, version));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// The cron
// ─────────────────────────────────────────────────────────────────────

export interface AopMetaLoopDeps {
  /**
   * The persisted registry store (Drizzle-backed in live mode; the
   * persistent-stores null object in degraded mode — the loop then sees
   * zero candidates and every tick is a free no-op).
   */
  readonly store: AOPRegistryStore;
  /** Null = no Anthropic key → fail-closed hold (never a fake pass). */
  readonly executor: AOPExecutor | null;
  /** Injectable for tests; defaults to the in-process governance adapter. */
  readonly adapter?: AOPCanaryAdapter;
  readonly logger?: PinoLikeLogger;
  readonly intervalMs?: number;
  /** Minimum regression pass-rate to promote past shadow (bridge gate). */
  readonly minRegressionPassRate?: number;
  readonly maxCandidatesPerTick?: number;
  /** Test override; default: on unless NODE_ENV=test or kill-switch off. */
  readonly enabled?: boolean;
  readonly clock?: () => Date;
  /** Env source (bootstrap-injected); defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface AopMetaLoopTickResult {
  /** Distinct AOP ids observed in the registry this tick. */
  readonly aopsSeen: number;
  /** Newest-version candidates awaiting promotion. */
  readonly candidates: number;
  /** Candidates newly enrolled at shadow (PROPOSE). */
  readonly enrolled: number;
  /** Regression suites replayed (REGRESSION). */
  readonly regressionsRun: number;
  /** One-rung promotions below live (CANARY). */
  readonly promoted: number;
  /** Candidates that reached live — registry active version flipped. */
  readonly activated: number;
  /** Regression-gate failures (no promotion happened). */
  readonly gateFailed: number;
  /** One-rung demotions after a gate failure above shadow. */
  readonly demoted: number;
  /** Candidates held fail-closed (missing set / no executor). */
  readonly skipped: number;
  /** Faults caught by the fail-safe rails. */
  readonly errored: number;
}

export interface AopMetaLoopHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<AopMetaLoopTickResult>;
}

const ZERO_RESULT: AopMetaLoopTickResult = Object.freeze({
  aopsSeen: 0,
  candidates: 0,
  enrolled: 0,
  regressionsRun: 0,
  promoted: 0,
  activated: 0,
  gateFailed: 0,
  demoted: 0,
  skipped: 0,
  errored: 0,
});

interface ComposedLoop {
  readonly registry: AOPRegistry;
  readonly bridge: AOPCanaryBridge;
  readonly regressionRunner: RegressionRunner | null;
}

/**
 * Derive this tick's candidates: for each AOP id, the NEWEST registered
 * version (registry insertion order — most recent = last) when it is not
 * already the active version. Pure over the registry snapshot.
 */
export function deriveCandidates(registry: AOPRegistry): {
  readonly aopsSeen: number;
  readonly candidates: ReadonlyArray<AOPSpec>;
} {
  const newestById = new Map<string, AOPSpec>();
  for (const spec of registry.listAOPs()) {
    newestById.set(spec.id, spec); // insertion order ⇒ last write = newest
  }
  const candidates: AOPSpec[] = [];
  for (const [id, newest] of newestById) {
    if (registry.activeVersion(id) !== newest.version) candidates.push(newest);
  }
  return Object.freeze({
    aopsSeen: newestById.size,
    candidates: Object.freeze(candidates),
  });
}

/**
 * Build the governed AOP meta-learning loop. Exposes the
 * `ClusterCronSupervisor`-compatible `start()` / `stop()` (so the
 * composition root wraps it in `withClusterLeader`) plus `tickOnce()`
 * for tests. Activation happens ONLY through the factories' own
 * regression+canary gate — this module adds no parallel apply path.
 */
export function createAopMetaLoopCron(deps: AopMetaLoopDeps): AopMetaLoopHandle {
  const logger = deps.logger ?? createPinoLikeLogger('aop-meta-loop');
  const env = deps.env ?? process.env;
  const intervalMs = clampInterval(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const threshold = deps.minRegressionPassRate ?? DEFAULT_MIN_REGRESSION_PASS_RATE;
  const maxCandidates = Math.max(
    1,
    deps.maxCandidatesPerTick ?? DEFAULT_MAX_CANDIDATES_PER_TICK,
  );
  const adapter = deps.adapter ?? createInProcessCanaryAdapter();
  const enabled =
    deps.enabled ?? (env.NODE_ENV !== 'test' && !killSwitchOff(env));

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let composedPromise: Promise<ComposedLoop> | null = null;

  // BOOT-PROOF SIGNAL — mirrors 'sovereign-orchestrator: main-loop wired' /
  // worldModelToolsRegistered: this line at composition time is the
  // detectable proof the meta-learning organ is no longer dark.
  logger.info(
    {
      wiring: 'aop-meta-loop',
      executorWired: deps.executor !== null,
      intervalMs,
      minRegressionPassRate: threshold,
      maxCandidatesPerTick: maxCandidates,
      killSwitchEnvFlag: AOP_META_LOOP_KILL_SWITCH_ENV,
      enabled,
    },
    'aop-meta-loop: meta-learning loop composed (OBSERVE → PROPOSE → REGRESSION → CANARY); activation only through the regression+canary gate',
  );

  /** Compose registry + bridge once, lazily; reset on failure for retry. */
  function getComposed(): Promise<ComposedLoop> {
    if (!composedPromise) {
      composedPromise = (async (): Promise<ComposedLoop> => {
        const registry = await createAOPRegistry({ store: deps.store });
        const bridge = createAOPCanaryBridge({
          registry,
          adapter,
          minRegressionPassRate: threshold,
        });
        const regressionRunner = deps.executor
          ? createRegressionRunner({
              runner: createAOPRunner({
                executor: deps.executor,
                ...(deps.clock ? { clock: deps.clock } : {}),
              }),
              ...(deps.clock ? { clock: deps.clock } : {}),
            })
          : null;
        return Object.freeze({ registry, bridge, regressionRunner });
      })().catch((err: unknown) => {
        composedPromise = null; // retry on the next tick
        throw err;
      });
    }
    return composedPromise;
  }

  interface MutableCounters {
    enrolled: number;
    regressionsRun: number;
    promoted: number;
    activated: number;
    gateFailed: number;
    demoted: number;
    skipped: number;
    errored: number;
  }

  async function processCandidate(
    loop: ComposedLoop,
    spec: AOPSpec,
    counters: MutableCounters,
  ): Promise<void> {
    const aopId = spec.id;
    const version = spec.version;
    try {
      // PROPOSE — enrol exactly once; re-enrolling would reset progress.
      let stage = await adapter.getStage(aopId, version);
      if (stage === null) {
        await adapter.enrol(aopId, version);
        stage = 'shadow';
        counters.enrolled += 1;
        logger.info(
          { aopId, version, stage },
          'aop-meta-loop: candidate enrolled at shadow (zero traffic, propose-only)',
        );
      }

      const set = loop.registry.getRegressionSet(spec.regressionSetId);
      if (!set) {
        counters.skipped += 1;
        logger.warn(
          { aopId, version, regressionSetId: spec.regressionSetId },
          'aop-meta-loop: regression set missing — candidate HELD (fail-closed, no promotion without a report)',
        );
        return;
      }
      if (!loop.regressionRunner) {
        counters.skipped += 1;
        logger.warn(
          { aopId, version, stage },
          'aop-meta-loop: executor unavailable (no Anthropic key) — candidate HELD (fail-closed, no promotion without a report)',
        );
        return;
      }

      // REGRESSION — a FRESH report gates every single rung.
      const report = await loop.regressionRunner.run(spec, set);
      counters.regressionsRun += 1;

      // CANARY — the factories' own gate; at 'live' the bridge atomically
      // flips the registry's active version (persisted via the store).
      const outcome = await loop.bridge.promote(aopId, version, report);
      switch (outcome.kind) {
        case 'activated':
          counters.activated += 1;
          logger.info(
            { aopId, version, passRate: report.passRate, stage: outcome.stage },
            'aop-meta-loop: candidate reached LIVE — registry active version flipped through the regression+canary gate',
          );
          return;
        case 'promoted':
          counters.promoted += 1;
          logger.info(
            { aopId, version, passRate: report.passRate, stage: outcome.stage },
            'aop-meta-loop: candidate promoted one canary rung (fresh regression pass)',
          );
          return;
        case 'regression-gate-failed': {
          counters.gateFailed += 1;
          if (stage !== 'shadow') {
            // Quality drift on a climbing candidate — one-rung rollback
            // (the bridge's own drift contract). At shadow we simply hold.
            const rollback = await loop.bridge.rollback(aopId, version);
            if (rollback.kind === 'demoted') {
              counters.demoted += 1;
            }
            logger.warn(
              {
                aopId,
                version,
                passRate: outcome.passRate,
                threshold: outcome.threshold,
                rollback: rollback.kind,
              },
              'aop-meta-loop: regression gate FAILED above shadow — rolled back one rung (quality drift)',
            );
            return;
          }
          logger.warn(
            {
              aopId,
              version,
              passRate: outcome.passRate,
              threshold: outcome.threshold,
            },
            'aop-meta-loop: regression gate FAILED — candidate held at shadow (never promoted)',
          );
          return;
        }
        case 'not-enrolled':
          counters.skipped += 1;
          logger.warn(
            { aopId, version },
            'aop-meta-loop: candidate not enrolled at promote time — skipped this tick',
          );
          return;
        default:
          return;
      }
    } catch (err) {
      counters.errored += 1;
      logger.error(
        { aopId, version, err: err instanceof Error ? err.message : String(err) },
        'aop-meta-loop: candidate processing failed (fail-safe — tick continues)',
      );
    }
  }

  async function tickOnce(): Promise<AopMetaLoopTickResult> {
    if (running) return ZERO_RESULT;
    running = true;
    const counters: MutableCounters = {
      enrolled: 0,
      regressionsRun: 0,
      promoted: 0,
      activated: 0,
      gateFailed: 0,
      demoted: 0,
      skipped: 0,
      errored: 0,
    };
    let aopsSeen = 0;
    let candidateCount = 0;
    try {
      const loop = await getComposed();
      // OBSERVE — re-hydrate from the persisted store every tick so specs
      // / regression sets registered by other replicas or surfaces are seen.
      await loop.registry.refresh();
      const derived = deriveCandidates(loop.registry);
      aopsSeen = derived.aopsSeen;
      const candidates = derived.candidates.slice(0, maxCandidates);
      candidateCount = candidates.length;
      for (const spec of candidates) {
        await processCandidate(loop, spec, counters);
      }
    } catch (err) {
      // The outermost guard — a fault here NEVER escapes the tick.
      counters.errored += 1;
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'aop-meta-loop: tick failed (fail-safe — loop keeps its cadence)',
      );
    } finally {
      running = false;
    }
    return Object.freeze({
      aopsSeen,
      candidates: candidateCount,
      enrolled: counters.enrolled,
      regressionsRun: counters.regressionsRun,
      promoted: counters.promoted,
      activated: counters.activated,
      gateFailed: counters.gateFailed,
      demoted: counters.demoted,
      skipped: counters.skipped,
      errored: counters.errored,
    });
  }

  return {
    start(): void {
      if (!enabled) {
        logger.info(
          { intervalMs, killSwitchEnvFlag: AOP_META_LOOP_KILL_SWITCH_ENV },
          'aop-meta-loop: disabled (no start)',
        );
        return;
      }
      if (timer) {
        logger.warn({}, 'aop-meta-loop: already running, ignoring duplicate start');
        return;
      }
      logger.info(
        { intervalMs, minRegressionPassRate: threshold },
        'aop-meta-loop: started',
      );
      timer = setInterval(() => {
        void tickOnce();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}
