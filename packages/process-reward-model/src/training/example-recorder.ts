/**
 * Example recorder — captures reasoning-trace examples for future PRM
 * training. See §5 of the spec. Pure factory + side-effect-free record
 * builder; the caller persists to `reasoning_traces` via Drizzle.
 */

import type {
  Observation,
  ReasoningStep,
  ReasoningTraceRecord,
} from '../types.js';

export interface ReasoningTraceDraft {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly intentKind: string;
  readonly trajectory: ReadonlyArray<{
    readonly step: ReasoningStep;
    readonly observation: Observation | null;
  }>;
}

export function buildReasoningTraceRecord(input: {
  readonly draft: ReasoningTraceDraft;
  readonly id: string;
  readonly capturedAt: string;
  readonly auditHash: string;
}): ReasoningTraceRecord {
  return Object.freeze({
    id: input.id,
    tenantId: input.draft.tenantId,
    sessionId: input.draft.sessionId,
    turnId: input.draft.turnId,
    intentKind: input.draft.intentKind,
    trajectory: Object.freeze(
      input.draft.trajectory.map((t) =>
        Object.freeze({
          step: t.step,
          observation: t.observation,
        }),
      ),
    ),
    outcomeLabel: null,
    outcomeSource: null,
    capturedAt: input.capturedAt,
    labeledAt: null,
    auditHash: input.auditHash,
  });
}
