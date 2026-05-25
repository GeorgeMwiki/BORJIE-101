/**
 * Self-Discover — shared types.
 *
 * Mirrors Zhou et al. 2024. A discovered reasoning structure is a JSON
 * DAG of steps: each step picks one primitive from the module library
 * (cf. `module-library.ts`), declares its input dependencies on prior
 * steps, and defines its expected output schema.
 *
 * The structure is task-class scoped — discover once, replay forever.
 * BORJIE stores the structure in K-D's TemporalKG so the next call
 * for the same `(task_class, jurisdiction)` reads from cache.
 */

import type { ReasoningPrimitive } from './module-library.js';

// ─────────────────────────────────────────────────────────────────────
// Task class — the cache key
// ─────────────────────────────────────────────────────────────────────

/**
 * Canonical BORJIE task classes. Extend cautiously — every new
 * task class triggers a fresh discovery cycle (3× one-time cost).
 */
export type BossnyumbaTaskClass =
  | 'eviction'
  | 'lease-renewal'
  | 'rent-collection'
  | 'tenant-dispute'
  | 'late-fee-compute'
  | 'rent-proration'
  | 'deposit-refund'
  | 'mediation-offer'
  | 'payment-plan'
  | 'kra-mri-submit'
  | 'tenant-onboarding'
  | 'maintenance-triage'
  | 'currency-convert'
  | 'rent-roll-consolidation'
  | 'portfolio-grading';

// ─────────────────────────────────────────────────────────────────────
// Schema-version — bumping this invalidates every cached structure
// ─────────────────────────────────────────────────────────────────────

export const REASONING_STRUCTURE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────
// Reasoning structure — emitted by IMPLEMENT, consumed by ReAct loop
// ─────────────────────────────────────────────────────────────────────

export interface ReasoningStep {
  readonly stepId: string;
  /** Primitive id from `module-library.ts`. */
  readonly primitive: string;
  /** Prior step ids this step depends on. May be empty. */
  readonly dependsOn: ReadonlyArray<string>;
  /** Expected JSON-Schema-lite shape of this step's output. */
  readonly outputSchema: Record<string, unknown>;
  /** Free-text rationale — what this step achieves for the task class. */
  readonly narrative: string;
}

export interface ReasoningStructure {
  /** Bumping schemaVersion invalidates every cached structure. */
  readonly schemaVersion: number;
  readonly taskClass: BossnyumbaTaskClass;
  /** Jurisdiction code (e.g. 'TZ-DSM', 'KE-NRB', 'GLOBAL'). */
  readonly jurisdiction: string;
  /** ISO timestamp of discovery. */
  readonly discoveredAt: string;
  /** Stable id for audit. */
  readonly structureId: string;
  /** Ordered DAG of steps. */
  readonly steps: ReadonlyArray<ReasoningStep>;
  /** The primitives selected during SELECT, in selection order. */
  readonly selectedPrimitives: ReadonlyArray<string>;
  /** ADAPT phase output — primitives rephrased for this task class. */
  readonly adaptedNarrative: string;
}

// ─────────────────────────────────────────────────────────────────────
// Sample input — used by SELECT + ADAPT to ground the discovery
// ─────────────────────────────────────────────────────────────────────

export interface TaskSampleInput {
  /** Free-text description of a representative instance. */
  readonly description: string;
  /** Optional structured variables that the real task will pass. */
  readonly variables?: Record<string, unknown>;
  /** Jurisdiction this sample is from. */
  readonly jurisdiction?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Cache port — TemporalKG-shaped, duck-typed so the substrate is
// import-safe without `@borjie/central-intelligence` as a dep.
// ─────────────────────────────────────────────────────────────────────

export interface ReasoningStructureCachePort {
  /**
   * Look up a structure by (taskClass, jurisdiction). Returns null on
   * miss. The schemaVersion check is the caller's responsibility.
   */
  lookup(args: {
    readonly taskClass: BossnyumbaTaskClass;
    readonly jurisdiction: string;
  }): Promise<ReasoningStructure | null>;

  /** Write a freshly discovered structure. Caller decides TTL semantics. */
  store(structure: ReasoningStructure): Promise<void>;

  /**
   * Invalidate (delete) every cached structure whose schemaVersion is
   * older than the current one. Returns the number invalidated.
   * Called on package boot.
   */
  invalidateStaleSchemaVersions(currentSchemaVersion: number): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Discoverer (LLM-backed); duck-typed so the substrate stays import-safe
// ─────────────────────────────────────────────────────────────────────

export interface DiscovererPort {
  /**
   * Given the SELECT/ADAPT/IMPLEMENT prompts, return the IMPLEMENT
   * step's parsed JSON. The port is responsible for prompting Claude
   * and parsing the response; this lets tests inject deterministic
   * stubs.
   */
  discover(args: {
    readonly taskClass: BossnyumbaTaskClass;
    readonly jurisdiction: string;
    readonly selectPrompt: string;
    readonly adaptPrompt: string;
    readonly implementPrompt: string;
    readonly library: ReadonlyArray<ReasoningPrimitive>;
    readonly samples: ReadonlyArray<TaskSampleInput>;
  }): Promise<{
    readonly selectedPrimitives: ReadonlyArray<string>;
    readonly adaptedNarrative: string;
    readonly steps: ReadonlyArray<ReasoningStep>;
  }>;
}
