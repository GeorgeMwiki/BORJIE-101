/**
 * `@borjie/cognitive-composition` — type contracts.
 *
 * Source of truth: `Docs/DESIGN/NEURO_WIRING_SOTA_2026.md` §6 (composition
 * root) and §8 (12-wire health probe). The composer wires the cognitive
 * subsystem ports together; this file owns the SHAPES the composer expects
 * its dependencies to satisfy.
 *
 * Every wire port is injectable so production code, unit tests, and the
 * health probe can substitute test doubles without pulling in the heavy
 * downstream packages (and without creating circular workspace deps).
 *
 * Style note (per ~/.claude/rules/coding-style.md):
 *   - Every shape is `Readonly<...>` — no mutation.
 *   - Errors carry typed `code` discriminators for structured handling.
 *   - Zod schemas mirror the SQL/CHECK shapes in migration 0076.
 *
 * @module @borjie/cognitive-composition/types
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// The 12 wires (one per cognitive subsystem)
// ===========================================================================

/**
 * Canonical wire identifiers — keep aligned with §8 of the design doc
 * and the migration `cwh_layer_chk` CHECK constraint. The probe iterates
 * this list; adding a wire requires:
 *   1) extend this tuple,
 *   2) extend `WireProbes` with a port factory,
 *   3) extend `buildDefaultProbes` to call it,
 *   4) add a test for the new wire.
 */
export const WIRE_NAMES = [
  'cognitive-engine.inference',
  'cognitive-memory.episodic',
  'cognitive-memory.semantic',
  'cognitive-memory.procedural',
  'cognitive-memory.reflective',
  'extended-reasoning.cot',
  'reasoning-substrate.compile',
  'central-intelligence.kernel',
  'calibration-monitor.confidence',
  'conformal-calibration-online.update',
  'audit-hash-chain.append',
  'brain-llm-router.cascade',
] as const;

export type WireName = (typeof WIRE_NAMES)[number];

// ---------------------------------------------------------------------------
// Wire health status
// ===========================================================================

export const WIRE_HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export type WireHealthStatus = (typeof WIRE_HEALTH_STATUSES)[number];

/**
 * Latency thresholds (per design doc §8.3). Mirrored in
 * {@link evaluateProbeOutcome}.
 *   - ok        : succeeded AND latency <= 800ms
 *   - degraded  : succeeded AND latency > 800ms
 *   - down      : timed out OR threw
 */
export const PROBE_TIMEOUT_MS = 2_000;
export const PROBE_DEGRADED_LATENCY_MS = 800;

export interface WireHealth {
  readonly wireName: WireName;
  readonly status: WireHealthStatus;
  readonly latencyMs: number;
  readonly lastError?: string;
  readonly probedAt: string;
}

export interface HealthReport {
  readonly wires: ReadonlyArray<WireHealth>;
  readonly overall: WireHealthStatus;
  readonly probedAt: string;
}

// ---------------------------------------------------------------------------
// Composer input + output
// ===========================================================================

export const CognitiveInputSchema = z
  .object({
    tenantId: z.string().min(1),
    turnId: z.string().min(1),
    userMessage: z.string().min(1),
    /** Optional scope hint (research / tab / doc / media / campaign). */
    scope: z.string().optional(),
    /** Optional thinking-budget hint passed to extended-reasoning. */
    thinkingBudgetTokens: z.number().int().positive().optional(),
  })
  .strict();

export type CognitiveInput = z.infer<typeof CognitiveInputSchema>;

export interface ProvenanceEntry {
  readonly wireName: WireName;
  readonly latencyMs: number;
  readonly rowHash: string;
}

export const CognitiveOutputSchema = z
  .object({
    tenantId: z.string().min(1),
    turnId: z.string().min(1),
    text: z.string(),
    confidence: z.number().min(0).max(1),
    confidenceLabel: z.enum(['high', 'medium', 'low', 'refused']),
    /** Hash-chain receipts for the wires that contributed. */
    provenance: z.array(
      z.object({
        wireName: z.enum(WIRE_NAMES),
        latencyMs: z.number().int().nonnegative(),
        rowHash: z.string().min(1),
      }),
    ),
    /** Memory tiers that actually responded (post-failover). */
    memoryTiersUsed: z.array(
      z.enum(['episodic', 'semantic', 'procedural', 'reflective']),
    ),
    /** Overall wire status at the moment of composition. */
    wireStatus: z.enum(WIRE_HEALTH_STATUSES),
  })
  .strict();

export type CognitiveOutput = z.infer<typeof CognitiveOutputSchema>;

// ---------------------------------------------------------------------------
// Errors — typed discriminators (per coding-style.md)
// ===========================================================================

export type CompositionErrorCode =
  | 'wire_down'
  | 'calibration_drift'
  | 'memory_tier_failure'
  | 'audit_chain_tampered'
  | 'tenant_isolation_violation';

class CompositionErrorBase extends Error {
  public readonly code: CompositionErrorCode;
  constructor(code: CompositionErrorCode, message: string) {
    super(message);
    this.name = 'CompositionError';
    this.code = code;
    // Per V8 best practice — keep stack pointing at the throw site.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WireDownError extends CompositionErrorBase {
  public readonly wireName: WireName;
  constructor(wireName: WireName, message?: string) {
    super('wire_down', message ?? `Critical wire down: ${wireName}`);
    this.name = 'WireDownError';
    this.wireName = wireName;
  }
}

export class CalibrationDriftError extends CompositionErrorBase {
  public readonly observedConfidence: number;
  public readonly threshold: number;
  constructor(observedConfidence: number, threshold: number, message?: string) {
    super(
      'calibration_drift',
      message ??
        `Calibration drift detected (observed=${observedConfidence}, threshold=${threshold})`,
    );
    this.name = 'CalibrationDriftError';
    this.observedConfidence = observedConfidence;
    this.threshold = threshold;
  }
}

export class MemoryTierFailureError extends CompositionErrorBase {
  public readonly tier: 'episodic' | 'semantic' | 'procedural' | 'reflective';
  constructor(
    tier: 'episodic' | 'semantic' | 'procedural' | 'reflective',
    message?: string,
  ) {
    super('memory_tier_failure', message ?? `Memory tier failed: ${tier}`);
    this.name = 'MemoryTierFailureError';
    this.tier = tier;
  }
}

export class AuditChainTamperedError extends CompositionErrorBase {
  public readonly expectedHash: string;
  public readonly actualHash: string;
  constructor(expectedHash: string, actualHash: string) {
    super(
      'audit_chain_tampered',
      `Audit chain rejected: expected=${expectedHash} actual=${actualHash}`,
    );
    this.name = 'AuditChainTamperedError';
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

export class TenantIsolationViolationError extends CompositionErrorBase {
  public readonly attemptedTenant: string;
  public readonly callingTenant: string;
  constructor(attemptedTenant: string, callingTenant: string) {
    super(
      'tenant_isolation_violation',
      `Tenant ${callingTenant} attempted to read tenant ${attemptedTenant} health rows`,
    );
    this.name = 'TenantIsolationViolationError';
    this.attemptedTenant = attemptedTenant;
    this.callingTenant = callingTenant;
  }
}

// ---------------------------------------------------------------------------
// Wire ports — minimal injectable surfaces (one per cognitive subsystem)
// ===========================================================================

/**
 * Every wire port reduces to a `probe()` thunk so the health prober can
 * iterate them uniformly. Each adapter keeps its own state via closure.
 * Functional ports avoid the circular-import trap with the upstream
 * packages (see §6.4 of the design doc).
 */
export type WireProbeFn = () => Promise<unknown>;

/**
 * Inference port — wraps `@borjie/cognitive-engine`.
 */
export interface InferencePort {
  readonly infer: (input: CognitiveInput) => Promise<{
    readonly text: string;
    readonly confidence: number;
  }>;
  readonly probe: WireProbeFn;
}

/**
 * Memory tier port — wraps `@borjie/cognitive-memory` per tier. A single
 * concrete adapter typically provides all four tiers; the probe granularity
 * is at the tier level because tiers fail independently in production.
 */
export type MemoryTier =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'reflective';

export interface MemoryTierPort {
  readonly tier: MemoryTier;
  readonly recall: (
    tenantId: string,
    query: string,
  ) => Promise<ReadonlyArray<{ readonly cellId: string; readonly text: string }>>;
  readonly probe: WireProbeFn;
}

/**
 * Chain-of-thought port — wraps `@borjie/extended-reasoning`.
 */
export interface CotPort {
  readonly cot: (input: { readonly prompt: string }) => Promise<{
    readonly trace: ReadonlyArray<string>;
  }>;
  readonly probe: WireProbeFn;
}

/**
 * Reasoning substrate port — wraps `@borjie/reasoning-substrate`.
 */
export interface SubstratePort {
  readonly compile: (input: { readonly task: string }) => Promise<{
    readonly programId: string;
  }>;
  readonly probe: WireProbeFn;
}

/**
 * Kernel port — wraps `@borjie/central-intelligence` hooks.
 */
export interface KernelPort {
  readonly hook: (event: { readonly kind: string }) => Promise<void>;
  readonly probe: WireProbeFn;
}

/**
 * Calibration port — wraps `@borjie/calibration-monitor`. Returns the
 * observed Brier/ECE drift signal; >`threshold` triggers
 * {@link CalibrationDriftError}.
 */
export interface CalibrationPort {
  readonly observe: (input: {
    readonly tenantId: string;
    readonly predictedConfidence: number;
  }) => Promise<{ readonly driftScore: number }>;
  readonly probe: WireProbeFn;
}

/**
 * Online conformal calibration port — wraps
 * `@borjie/conformal-calibration-online`.
 */
export interface ConformalPort {
  readonly update: (input: { readonly covered: boolean }) => Promise<{
    readonly alpha: number;
  }>;
  readonly probe: WireProbeFn;
}

/**
 * Audit chain port — wraps `@borjie/audit-hash-chain`.
 */
export interface AuditChainPort {
  readonly append: (payload: {
    readonly tenantId: string;
    readonly turnId: string;
    readonly wireName: WireName;
    readonly latencyMs: number;
  }) => Promise<{ readonly rowHash: string; readonly prevHash: string }>;
  readonly verify: (chain: ReadonlyArray<{
    readonly prevHash: string;
    readonly rowHash: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }>) => Promise<{ readonly ok: boolean; readonly firstBrokenIndex: number | null }>;
  readonly probe: WireProbeFn;
}

/**
 * Brain LLM router port — wraps `@borjie/brain-llm-router`.
 */
export interface BrainRouterPort {
  readonly cascade: (input: {
    readonly tenantId: string;
    readonly prompt: string;
  }) => Promise<{ readonly text: string; readonly modelId: string }>;
  readonly probe: WireProbeFn;
}

// ---------------------------------------------------------------------------
// Health-store port — Drizzle/Postgres writer for `cognitive_wiring_health`.
// ===========================================================================

export interface WireHealthRow {
  readonly tenantId: string;
  readonly wireName: WireName;
  readonly status: WireHealthStatus;
  readonly latencyMs: number;
  readonly lastError?: string;
  readonly probedAt: string;
}

export interface WireHealthStore {
  /** Idempotent upsert keyed on (tenantId, wireName). */
  readonly upsert: (row: WireHealthRow) => Promise<void>;
  /** Tenant-scoped read; returns ONLY rows that belong to `tenantId`. */
  readonly list: (tenantId: string) => Promise<ReadonlyArray<WireHealthRow>>;
}

// ---------------------------------------------------------------------------
// Composition dependencies — the single object passed to the factory
// ===========================================================================

export interface CompositionDeps {
  readonly inference: InferencePort;
  readonly memoryTiers: {
    readonly episodic: MemoryTierPort;
    readonly semantic: MemoryTierPort;
    readonly procedural: MemoryTierPort;
    readonly reflective: MemoryTierPort;
  };
  readonly cot: CotPort;
  readonly substrate: SubstratePort;
  readonly kernel: KernelPort;
  readonly calibration: CalibrationPort;
  readonly conformal: ConformalPort;
  readonly audit: AuditChainPort;
  readonly brainRouter: BrainRouterPort;
  readonly healthStore: WireHealthStore;
  /** Calibration drift threshold; default 0.5. */
  readonly driftThreshold?: number;
  /** Wires that, when down, cause `compose()` to throw rather than degrade. */
  readonly criticalWires?: ReadonlyArray<WireName>;
  /** Injectable clock for deterministic tests. */
  readonly clock?: { readonly nowIso: () => string };
}

export interface CognitiveComposition {
  readonly compose: (input: CognitiveInput) => Promise<CognitiveOutput>;
  readonly wireHealth: () => Promise<HealthReport>;
}
