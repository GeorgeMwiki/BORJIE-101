/**
 * Kernel substrate service — Drizzle-backed adapters for the
 * central-intelligence brain kernel's three pluggable sinks:
 *
 *   - CotReservoirSink      → kernel_cot_reservoir
 *   - PersonaDriftSink      → kernel_persona_drift_events
 *   - ProvenanceSink        → kernel_provenance
 *
 * The kernel itself imports nothing from this package — it speaks the
 * port interfaces. This file is the production adapter that the api-
 * gateway (or any other composition root) wires up.
 *
 * The kernel's port types are intentionally re-declared here as a
 * narrow structural duck so this package does NOT need to depend on
 * @borjie/central-intelligence at compile time. The shape is
 * stable; if it changes a unit test in central-intelligence will
 * break first.
 */

import { randomUUID } from 'crypto';
import {
  kernelCotReservoir,
  kernelPersonaDriftEvents,
  kernelProvenance,
} from '../schemas/kernel-substrate.schema.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port surface — duck-typed copy of the kernel's sink ports.
// ─────────────────────────────────────────────────────────────────────

export interface CotSampleShape {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  /** PII-scrubbed thought text safe to persist. */
  readonly thoughtText: string;
  /**
   * SHA-256 (hex) of the original, pre-scrub thought. Optional for
   * back-compat with callers that have not yet upgraded to the
   * Wave-K scrubbing CoT reservoir.
   */
  readonly promptHash?: string;
  /** SHA-256 (hex) of the sanitised text actually stored. */
  readonly responseHash?: string;
  readonly capturedAt: string;
}

export interface PersonaDriftShape {
  readonly thoughtId: string;
  readonly personaId: string;
  readonly violationType: 'taboo' | 'first-person-loss' | 'tone' | 'fabrication';
  readonly excerpt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detectedAt: string;
}

export interface ProvenanceShape {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly scopeKind: 'tenant' | 'platform';
  readonly tier: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly inputHash: string;
  readonly outputHash: string;
  readonly sensorId: string;
  readonly modelId: string;
  readonly cacheHit: boolean;
  readonly judgeScore: number | null;
  readonly cohortFingerprints: ReadonlyArray<string>;
  readonly toolCallSummaries: ReadonlyArray<{
    readonly toolName: string;
    readonly latencyMs: number;
    readonly ok: boolean;
  }>;
  readonly latencyMs: number;
  readonly producedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Tenant-scoping context — the kernel's ScopeContext is platform vs
// tenant; for platform-scope thoughts there is no tenant_id, which
// matches the schema's nullable column.
// ─────────────────────────────────────────────────────────────────────

export interface KernelSinkScope {
  readonly tenantId: string | null;
}

export interface KernelSubstrateService {
  readonly cot: { capture(sample: CotSampleShape): Promise<void> };
  readonly drift: { record(event: PersonaDriftShape): Promise<void> };
  readonly provenance: { record(rec: ProvenanceShape): Promise<void> };
}

export function createKernelSubstrateService(
  db: DatabaseClient,
  scope: KernelSinkScope,
): KernelSubstrateService {
  // Drizzle's generated insertable type drops nullable + default columns
  // when consumed across the package's compiled `dist/` boundary, so the
  // `.values({...})` literals would fail TypeScript excess-property
  // checks even though the runtime SQL is correct. We narrow to a
  // structural shape and cast at the boundary.
  return {
    cot: {
      async capture(sample) {
        await db
          .insert(kernelCotReservoir)
          .values({
            thoughtId: sample.thoughtId,
            tenantId: scope.tenantId,
            threadId: sample.threadId,
            stakes: sample.stakes,
            thoughtText: sample.thoughtText,
            promptHash: sample.promptHash ?? null,
            responseHash: sample.responseHash ?? null,
            capturedAt: new Date(sample.capturedAt),
          } as never)
          .onConflictDoNothing();
      },
    },
    drift: {
      async record(event) {
        await db
          .insert(kernelPersonaDriftEvents)
          .values({
            id: randomUUID(),
            thoughtId: event.thoughtId,
            tenantId: scope.tenantId,
            personaId: event.personaId,
            violationType: event.violationType,
            severity: event.severity,
            excerpt: event.excerpt,
            detectedAt: new Date(event.detectedAt),
          } as never);
      },
    },
    provenance: {
      async record(rec) {
        const tier = rec.tier as
          | 'tenant' | 'lease' | 'unit' | 'block'
          | 'property' | 'portfolio' | 'org' | 'industry';
        await db
          .insert(kernelProvenance)
          .values({
            thoughtId: rec.thoughtId,
            tenantId: scope.tenantId,
            threadId: rec.threadId,
            scopeKind: rec.scopeKind,
            tier,
            stakes: rec.stakes,
            inputHash: rec.inputHash,
            outputHash: rec.outputHash,
            sensorId: rec.sensorId,
            modelId: rec.modelId,
            cacheHit: rec.cacheHit ? 'true' : 'false',
            judgeScore: rec.judgeScore,
            cohortFingerprints: [...rec.cohortFingerprints],
            toolCallSummaries: rec.toolCallSummaries.map((t) => ({ ...t })),
            latencyMs: rec.latencyMs,
            producedAt: new Date(rec.producedAt),
          } as never)
          .onConflictDoNothing();
      },
    },
  };
}
