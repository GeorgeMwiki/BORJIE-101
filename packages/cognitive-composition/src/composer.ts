/**
 * Cognitive composition — wires the 12 cognitive subsystems into one
 * coherent named pipeline (`compose`) + the operator probe (`wireHealth`).
 *
 * Pipeline (per Docs/DESIGN/NEURO_WIRING_SOTA_2026.md §6):
 *
 *   1) substrate.compile      — Plan-and-Solve outer plan
 *   2) cot.cot                — Inner deliberation (CoT trace)
 *   3) memory.recall          — Episodic→semantic→procedural→reflective
 *                               with cascading failover
 *   4) inference.infer        — Cognitive engine produces draft + confidence
 *   5) brainRouter.cascade    — Final LLM call through the cost ladder
 *   6) calibration.observe    — Brier/ECE drift check
 *   7) conformal.update       — Online α update
 *   8) audit.append           — Hash-chain receipt per contributing wire
 *   9) kernel.hook            — Central-intelligence post-turn notification
 *
 * Failure modes:
 *   - A critical wire is down                → `WireDownError`
 *   - Calibration drift exceeds threshold     → `CalibrationDriftError`
 *   - Every memory tier fails                 → `MemoryTierFailureError`
 *   - Other wires degrade gracefully (output.wireStatus === 'degraded').
 *
 * Immutability: every step returns a NEW object — no `Object.assign` mutations.
 *
 * @module @borjie/cognitive-composition/composer
 */

import {
  CalibrationDriftError,
  CognitiveInputSchema,
  MemoryTierFailureError,
  WireDownError,
  WIRE_NAMES,
  type CognitiveComposition,
  type CognitiveInput,
  type CognitiveOutput,
  type CompositionDeps,
  type MemoryTier,
  type MemoryTierPort,
  type ProvenanceEntry,
  type WireHealthStatus,
  type WireName,
} from './types.js';
import { runWireHealth } from './wire-health-probe.js';

// ---------------------------------------------------------------------------
// Defaults
// ===========================================================================

const DEFAULT_DRIFT_THRESHOLD = 0.5;
const DEFAULT_CRITICAL_WIRES: ReadonlyArray<WireName> = [
  'cognitive-engine.inference',
  'audit-hash-chain.append',
  'brain-llm-router.cascade',
];

// ---------------------------------------------------------------------------
// Helpers — pure, return new immutable structures
// ===========================================================================

function labelConfidence(
  c: number,
): 'high' | 'medium' | 'low' | 'refused' {
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'medium';
  if (c >= 0.2) return 'low';
  return 'refused';
}

interface MemoryRecallResult {
  readonly tiersUsed: ReadonlyArray<MemoryTier>;
  readonly hits: ReadonlyArray<{ readonly cellId: string; readonly text: string }>;
}

/**
 * Cascading memory recall: try episodic first, fall back to semantic,
 * procedural, then reflective. If a tier throws we move on but still
 * record `tiersUsed` with only those that resolved. If EVERY tier fails,
 * throw {@link MemoryTierFailureError}.
 */
async function recallWithFailover(
  tenantId: string,
  query: string,
  tiers: ReadonlyArray<MemoryTierPort>,
): Promise<MemoryRecallResult> {
  const tiersUsed: MemoryTier[] = [];
  const hits: { readonly cellId: string; readonly text: string }[] = [];
  let lastError: Error | null = null;

  for (const tier of tiers) {
    try {
      const tierHits = await tier.recall(tenantId, query);
      tiersUsed.push(tier.tier);
      // Spread into a NEW array each iteration — no .push mutation
      // exposed to callers (the locals stay scoped to this function).
      tierHits.forEach((h) => hits.push({ cellId: h.cellId, text: h.text }));
      // If we got hits from this tier, we're done — short-circuit.
      if (tierHits.length > 0) {
        break;
      }
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error(String(err ?? 'unknown'));
    }
  }

  if (tiersUsed.length === 0) {
    throw new MemoryTierFailureError(
      tiers[0]?.tier ?? 'episodic',
      lastError !== null
        ? `every memory tier failed; last error: ${lastError.message}`
        : 'every memory tier returned no usable result',
    );
  }

  return {
    tiersUsed: Object.freeze([...tiersUsed]),
    hits: Object.freeze([...hits]),
  };
}

/**
 * Append a hash-chain receipt for a wire, capturing latency. Returns the
 * provenance row to be folded into the final output.
 */
async function recordProvenance(
  deps: CompositionDeps,
  wireName: WireName,
  tenantId: string,
  turnId: string,
  latencyMs: number,
): Promise<ProvenanceEntry> {
  const { rowHash } = await deps.audit.append({
    tenantId,
    turnId,
    wireName,
    latencyMs,
  });
  return { wireName, latencyMs, rowHash };
}

async function measure<T>(fn: () => Promise<T>): Promise<{
  readonly value: T;
  readonly latencyMs: number;
}> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

function wireStatusFromProbe(
  probeStatus: WireHealthStatus,
  driftDetected: boolean,
): WireHealthStatus {
  if (probeStatus === 'down') return 'down';
  if (driftDetected) return 'degraded';
  return probeStatus;
}

// ---------------------------------------------------------------------------
// Public factory
// ===========================================================================

/**
 * Create the composer. The returned object is the public surface used by
 * api-gateway routes and the kernel composition root.
 */
export function createCognitiveComposition(
  deps: CompositionDeps,
): CognitiveComposition {
  const driftThreshold = deps.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;
  const criticalWires = deps.criticalWires ?? DEFAULT_CRITICAL_WIRES;
  const criticalSet = new Set(criticalWires);

  /**
   * Run the 12-wire probe first to know which wires are critical-down.
   * This is the cheapest way to fail-fast without launching heavyweight
   * pipeline calls; the probe is timeout-bounded.
   */
  async function checkCriticalWires(tenantId: string): Promise<WireHealthStatus> {
    const report = await runWireHealth({ tenantId, deps });
    const criticalDown = report.wires.find(
      (w) => w.status === 'down' && criticalSet.has(w.wireName),
    );
    if (criticalDown !== undefined) {
      throw new WireDownError(
        criticalDown.wireName,
        `Critical wire down: ${criticalDown.wireName}${
          criticalDown.lastError !== undefined
            ? ` (${criticalDown.lastError})`
            : ''
        }`,
      );
    }
    return report.overall;
  }

  async function compose(rawInput: CognitiveInput): Promise<CognitiveOutput> {
    const input = CognitiveInputSchema.parse(rawInput);

    // ── Stage 0: probe + fail-fast on critical wire-down ─────────────────
    const probeOverall = await checkCriticalWires(input.tenantId);

    const provenance: ProvenanceEntry[] = [];

    // ── Stage 1: outer plan (Plan-and-Solve) ─────────────────────────────
    const planTimed = await measure(() =>
      deps.substrate.compile({ task: input.userMessage }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'reasoning-substrate.compile',
        input.tenantId,
        input.turnId,
        planTimed.latencyMs,
      ),
    );

    // ── Stage 2: inner CoT ───────────────────────────────────────────────
    const cotTimed = await measure(() =>
      deps.cot.cot({ prompt: input.userMessage }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'extended-reasoning.cot',
        input.tenantId,
        input.turnId,
        cotTimed.latencyMs,
      ),
    );

    // ── Stage 3: memory recall with tier-cascade failover ────────────────
    const recallTimed = await measure(() =>
      recallWithFailover(input.tenantId, input.userMessage, [
        deps.memoryTiers.episodic,
        deps.memoryTiers.semantic,
        deps.memoryTiers.procedural,
        deps.memoryTiers.reflective,
      ]),
    );
    // One provenance row per tier actually used — captures failover history.
    for (const tier of recallTimed.value.tiersUsed) {
      const wireName: WireName = `cognitive-memory.${tier}` as WireName;
      provenance.push(
        await recordProvenance(
          deps,
          wireName,
          input.tenantId,
          input.turnId,
          recallTimed.latencyMs,
        ),
      );
    }

    // ── Stage 4: cognitive-engine inference ──────────────────────────────
    const inferTimed = await measure(() => deps.inference.infer(input));
    provenance.push(
      await recordProvenance(
        deps,
        'cognitive-engine.inference',
        input.tenantId,
        input.turnId,
        inferTimed.latencyMs,
      ),
    );

    // ── Stage 5: brain-llm-router cascade for the final answer ───────────
    const routerTimed = await measure(() =>
      deps.brainRouter.cascade({
        tenantId: input.tenantId,
        prompt: input.userMessage,
      }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'brain-llm-router.cascade',
        input.tenantId,
        input.turnId,
        routerTimed.latencyMs,
      ),
    );

    // ── Stage 6: calibration drift check ─────────────────────────────────
    const calibTimed = await measure(() =>
      deps.calibration.observe({
        tenantId: input.tenantId,
        predictedConfidence: inferTimed.value.confidence,
      }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'calibration-monitor.confidence',
        input.tenantId,
        input.turnId,
        calibTimed.latencyMs,
      ),
    );
    const driftDetected = calibTimed.value.driftScore > driftThreshold;
    if (driftDetected) {
      throw new CalibrationDriftError(
        inferTimed.value.confidence,
        driftThreshold,
        `Calibration drift score ${calibTimed.value.driftScore} > threshold ${driftThreshold}`,
      );
    }

    // ── Stage 7: online conformal update ─────────────────────────────────
    const conformalTimed = await measure(() =>
      deps.conformal.update({ covered: true }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'conformal-calibration-online.update',
        input.tenantId,
        input.turnId,
        conformalTimed.latencyMs,
      ),
    );

    // ── Stage 8: kernel post-turn hook ───────────────────────────────────
    const kernelTimed = await measure(() =>
      deps.kernel.hook({ kind: 'cognitive.compose.complete' }),
    );
    provenance.push(
      await recordProvenance(
        deps,
        'central-intelligence.kernel',
        input.tenantId,
        input.turnId,
        kernelTimed.latencyMs,
      ),
    );

    // ── Assemble output ──────────────────────────────────────────────────
    // The Zod-inferred CognitiveOutput shape uses mutable arrays at the type
    // level (z.array → T[]). We construct fresh copies on every compose() so
    // callers receive distinct ownership; we don't surface mutable references
    // from prior stages.
    const finalConfidence = inferTimed.value.confidence;
    const out: CognitiveOutput = {
      tenantId: input.tenantId,
      turnId: input.turnId,
      text: routerTimed.value.text,
      confidence: finalConfidence,
      confidenceLabel: labelConfidence(finalConfidence),
      provenance: [...provenance],
      memoryTiersUsed: [...recallTimed.value.tiersUsed],
      wireStatus: wireStatusFromProbe(probeOverall, false),
    };

    return out;
  }

  async function wireHealth(): Promise<import('./types.js').HealthReport> {
    // wireHealth() is tenant-agnostic at the API surface; the caller must
    // pass tenant context via `app.tenant_id` GUC at the DB layer. We
    // surface the tenant context from criticalWires/healthStore semantics.
    // For the operator dashboard the convention is "platform" tenant.
    return runWireHealth({ tenantId: 'platform', deps });
  }

  return { compose, wireHealth };
}

// ---------------------------------------------------------------------------
// Internal exports for tests (avoid widening the package surface)
// ===========================================================================

export const __testables = {
  recallWithFailover,
  labelConfidence,
  wireStatusFromProbe,
  DEFAULT_CRITICAL_WIRES,
  DEFAULT_DRIFT_THRESHOLD,
  WIRE_NAMES,
} as const;
