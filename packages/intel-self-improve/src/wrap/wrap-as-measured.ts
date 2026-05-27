/**
 * `wrapAsMeasured` — turn any `(input) => Promise<output>` intel
 * function into a measured capability invocation.
 *
 * Spec §2 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * For every call the wrapper:
 *
 *   1. Generates a UUID v4 invocation id.
 *   2. Captures latency wall-clock and the claimed-confidence
 *      extracted from the output.
 *   3. Builds an audit-chain row from the prior `intel_invocation_audit`
 *      row in the (tenant, intel_kind) chain — Trillian-style append
 *      (Google Trillian, https://github.com/google/trillian).
 *   4. Persists into:
 *        a) `intel_invocation_audit` via the supplied detail repo.
 *        b) `capability_invocations` via the supplied catalogue
 *           invocation repo (so the existing measurement worker
 *           observes the call exactly as it observes research_v1).
 *        c) `intel_skill_traces` via the supplied skill-trace repo
 *           (Voyager-style counter — Wang et al., arXiv 2305.16291).
 *   5. Returns the unchanged output to the caller.
 *
 * Steps 4a/4b/4c are fire-and-forget — the caller's latency budget is
 * the underlying domain call plus the audit-hash compute (sub-ms on
 * commodity hardware per Trillian's benchmarks). Persistence errors
 * are logged via the supplied logger but never propagated.
 *
 * @module @borjie/intel-self-improve/wrap/wrap-as-measured
 */

import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, hashChainEntry } from '@borjie/audit-hash-chain';
import type { Logger } from '@borjie/observability';
import type { InvocationRepository } from '@borjie/capability-catalogue';
import type { IntelInvocationAuditRepository } from '../repositories/intel-invocation-audit-repository.js';
import type { IntelSkillTracesRepository } from '../repositories/intel-skill-traces-repository.js';
import type {
  IntelInvocationContext,
  IntelKind,
  MeasuredCapability,
} from '../types.js';

// ---------------------------------------------------------------------------
// Wrapper dependencies
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface IdGen {
  next(): string;
}

export const SYSTEM_CLOCK: Clock = Object.freeze({
  now: () => new Date(),
});

export const RANDOM_UUID_GEN: IdGen = Object.freeze({
  next: () => randomUUID(),
});

export interface WrapAsMeasuredDeps {
  readonly invocationAuditRepo: IntelInvocationAuditRepository;
  readonly catalogueInvocationRepo: InvocationRepository;
  readonly skillTracesRepo: IntelSkillTracesRepository;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly idGen?: IdGen;
}

// ---------------------------------------------------------------------------
// Pattern signature — sha256 over canonical-json of the input
// ---------------------------------------------------------------------------

/**
 * Sha-256 over canonical-JSON of the wrapped input projection. Used as
 * the `intel_skill_traces.pattern_signature` so similar inputs share
 * a counter. The hash is deterministic across processes — see the
 * canonical-json contract in `@borjie/audit-hash-chain`.
 */
export function patternSignatureFor(
  payload: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

// ---------------------------------------------------------------------------
// wrapAsMeasured — the higher-order wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a domain-level intel function with measurement telemetry. The
 * returned function has the **identical** signature — callers swap in
 * the wrapped version at the composition root.
 *
 * No domain logic is added. The wrapper only observes.
 */
export function wrapAsMeasured<TInput, TOutput>(
  capability: MeasuredCapability<TInput, TOutput>,
  underlying: (input: TInput) => Promise<TOutput>,
  deps: WrapAsMeasuredDeps,
): (input: TInput) => Promise<TOutput> {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idGen = deps.idGen ?? RANDOM_UUID_GEN;

  return async (input: TInput): Promise<TOutput> => {
    const invokedAt = clock.now();
    const t0 = Date.now();

    const output = await underlying(input);

    const latencyMs = Math.max(0, Date.now() - t0);
    const inputPayload = capability.hashInput(input);
    const outputPayload = capability.hashOutput(output);
    const claimedConfidence = clamp01(
      capability.claimedConfidenceFrom(output),
    );
    const costUsdCents = capability.costCentsFrom
      ? Math.max(0, Math.floor(capability.costCentsFrom(output)))
      : 0;

    void emitTelemetry({
      capability,
      deps,
      idGen,
      invocationId: idGen.next(),
      invokedAt,
      inputPayload,
      outputPayload,
      claimedConfidence,
      latencyMs,
      costUsdCents,
    }).catch((error: unknown) => {
      deps.logger.error('intel-self-improve telemetry emit failed', {
        capabilityId: capability.capabilityId,
        intelKind: capability.intelKind,
        error,
      });
    });

    return output;
  };
}

// ---------------------------------------------------------------------------
// Telemetry pipeline — extracted for direct testing
// ---------------------------------------------------------------------------

export interface EmitTelemetryArgs<TInput, TOutput> {
  readonly capability: MeasuredCapability<TInput, TOutput>;
  readonly deps: WrapAsMeasuredDeps;
  readonly idGen: IdGen;
  readonly invocationId: string;
  readonly invokedAt: Date;
  readonly inputPayload: Readonly<Record<string, unknown>>;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly claimedConfidence: number;
  readonly latencyMs: number;
  readonly costUsdCents: number;
}

export async function emitTelemetry<TInput, TOutput>(
  args: EmitTelemetryArgs<TInput, TOutput>,
): Promise<IntelInvocationContext> {
  const { capability, deps, idGen } = args;
  const prevHash = await deps.invocationAuditRepo.latestAuditHash({
    tenantId: capability.tenantId,
    intelKind: capability.intelKind,
  });
  const auditHash = hashChainEntry({
    prev: prevHash,
    payload: {
      tenantId: capability.tenantId,
      capabilityId: capability.capabilityId,
      intelKind: capability.intelKind,
      input: args.inputPayload,
      output: args.outputPayload,
      claimedConfidence: args.claimedConfidence,
      invokedAt: args.invokedAt.toISOString(),
    },
  });

  const ctx: IntelInvocationContext = Object.freeze({
    id: args.invocationId,
    tenantId: capability.tenantId,
    capabilityId: capability.capabilityId,
    intelKind: capability.intelKind,
    inputPayload: args.inputPayload,
    outputPayload: args.outputPayload,
    claimedConfidence: args.claimedConfidence,
    latencyMs: args.latencyMs,
    costUsdCents: args.costUsdCents,
    invokedAt: args.invokedAt.toISOString(),
    prevHash,
    auditHash,
  });

  await deps.invocationAuditRepo.insert(ctx);
  await deps.catalogueInvocationRepo.insert({
    id: args.invocationId,
    tenantId: capability.tenantId,
    capabilityId: capability.capabilityId,
    invokedAt: args.invokedAt.toISOString(),
    latencyMs: args.latencyMs,
    success: true,
    errorKind: null,
    costUsdCents: args.costUsdCents,
    auditHash,
  });
  await deps.skillTracesRepo.tick({
    id: idGen.next(),
    tenantId: capability.tenantId,
    intelKind: capability.intelKind,
    patternSignature: patternSignatureFor(args.inputPayload),
    capabilityId: capability.capabilityId,
    success: true,
    seenAt: args.invokedAt.toISOString(),
  });

  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Convenience helper: build a `MeasuredCapability` descriptor with
 * sensible defaults from a partial spec. Reserved for tests and
 * call-site authoring sugar — production capability descriptors
 * remain explicit.
 */
export function buildMeasuredCapability<TInput, TOutput>(args: {
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly intelKind: IntelKind;
  readonly claimedConfidenceFrom: (output: TOutput) => number;
  readonly hashInput: (input: TInput) => Readonly<Record<string, unknown>>;
  readonly hashOutput: (output: TOutput) => Readonly<Record<string, unknown>>;
  readonly costCentsFrom?: (output: TOutput) => number;
}): MeasuredCapability<TInput, TOutput> {
  return Object.freeze({
    capabilityId: args.capabilityId,
    tenantId: args.tenantId,
    intelKind: args.intelKind,
    claimedConfidenceFrom: args.claimedConfidenceFrom,
    hashInput: args.hashInput,
    hashOutput: args.hashOutput,
    ...(args.costCentsFrom ? { costCentsFrom: args.costCentsFrom } : {}),
  });
}
