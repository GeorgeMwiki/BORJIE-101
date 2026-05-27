/**
 * Curator: pulls traces, redacts PII, deduplicates, reward-shapes.
 *
 * Pure functions only. Side effects (DB writes, audit-chain hashing)
 * happen in the runner — the curator returns shaped examples; the
 * runner persists them.
 *
 * Spec: Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md §2.2 + §2.3.
 */

import type {
  ClockPort,
  Example,
  PIIRedactor,
  RawTrace,
  RewardShapingConfig,
  UuidPort,
} from '../types.js';
import { DEFAULT_REWARD_SHAPING } from '../types.js';

// ---------------------------------------------------------------------------
// Canonical JSON dedup key — stable string for any value.
// ---------------------------------------------------------------------------

/**
 * Stable canonical JSON for any structurally-acyclic value.
 * Sorts object keys, treats `undefined` as omission.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      pairs.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${pairs.join(',')}}`;
  }
  // function, symbol, bigint — coerce defensively.
  return 'null';
}

// ---------------------------------------------------------------------------
// Reward shaping
// ---------------------------------------------------------------------------

/**
 * Pure reward shaping. Clipping is applied so the result lies in
 * [-1, 1].
 */
export function shapeReward(
  trace: RawTrace,
  config: RewardShapingConfig = DEFAULT_REWARD_SHAPING,
): number {
  const raw =
    config.alpha * trace.baseReward +
    config.beta * trace.coverageScore -
    config.gamma * trace.redactionPenalty;
  if (raw > 1) return 1;
  if (raw < -1) return -1;
  return raw;
}

// ---------------------------------------------------------------------------
// Curate
// ---------------------------------------------------------------------------

export interface CurateParams {
  readonly tenantId: string;
  readonly metaRunId: string;
  readonly traces: ReadonlyArray<RawTrace>;
  readonly redactor: PIIRedactor;
  readonly clock: ClockPort;
  readonly uuid: UuidPort;
  readonly auditChain: (payload: Readonly<Record<string, unknown>>) => string;
  readonly config?: RewardShapingConfig;
}

export interface CurateOutcome {
  readonly examples: ReadonlyArray<Example>;
  readonly droppedDuplicates: number;
  readonly droppedLowReward: number;
  readonly droppedHighRedaction: number;
}

/**
 * Curate raw traces into examples. Drops duplicates by canonical-JSON
 * key, drops examples below the reward floor, drops examples above
 * the redaction-penalty ceiling.
 */
export function curateExamples(params: CurateParams): CurateOutcome {
  const config = params.config ?? DEFAULT_REWARD_SHAPING;
  const seen = new Set<string>();
  const examples: Example[] = [];
  let droppedDuplicates = 0;
  let droppedLowReward = 0;
  let droppedHighRedaction = 0;

  for (const trace of params.traces) {
    if (trace.tenantId !== params.tenantId) {
      // Cross-tenant pollution: refuse.
      continue;
    }

    const reward = shapeReward(trace, config);

    if (trace.redactionPenalty > config.maxRedactionPenalty) {
      droppedHighRedaction += 1;
      continue;
    }
    if (reward < config.minReward) {
      droppedLowReward += 1;
      continue;
    }

    const redactedPrompt = params.redactor.redact(trace.prompt);
    const redactedCompletion = params.redactor.redact(trace.completion);

    const dedupKey = canonicalJson({
      prompt: redactedPrompt,
      completion: redactedCompletion,
    });
    if (seen.has(dedupKey)) {
      droppedDuplicates += 1;
      continue;
    }
    seen.add(dedupKey);

    const payload = {
      tenantId: params.tenantId,
      metaRunId: params.metaRunId,
      prompt: redactedPrompt,
      completion: redactedCompletion,
      reward,
      curatedAt: params.clock.nowIso(),
    } as const;

    const example: Example = {
      id: params.uuid.next(),
      tenantId: params.tenantId,
      metaRunId: params.metaRunId,
      prompt: (redactedPrompt ?? {}) as Readonly<Record<string, unknown>>,
      completion: (redactedCompletion ?? {}) as Readonly<
        Record<string, unknown>
      >,
      reward,
      included: true,
      auditHash: params.auditChain(payload),
    };
    examples.push(example);
  }

  return {
    examples,
    droppedDuplicates,
    droppedLowReward,
    droppedHighRedaction,
  };
}
