/**
 * Label collector — propagates a verified outcome label backward through
 * a trace using the Math-Shepherd "completer" technique (§5 step 2 of
 * the spec). Pure: takes the trace + completer agreement counts and
 * emits `(state, step, label)` examples.
 *
 * The actual completer runs are performed by the caller (a worker that
 * replays from each step and counts successful completions). This file
 * is just the deterministic projection: given completion ratios, emit
 * a labeled example per step.
 */

import type {
  PrmTrainingExample,
  ReasoningState,
  ReasoningStep,
  ReasoningTraceRecord,
} from '../types.js';

export interface StepCompletionRatio {
  readonly stepIndex: number;
  readonly completerAgreementRatio: number;
}

export interface LabelCollectorInput {
  readonly trace: ReasoningTraceRecord;
  readonly ratios: ReadonlyArray<StepCompletionRatio>;
  readonly positiveThreshold: number;
  readonly nowIso: string;
  readonly auditHashOf: (exampleSeed: string) => string;
  readonly idOf: (exampleSeed: string) => string;
}

function buildStateAt(
  trace: ReasoningTraceRecord,
  index: number,
): ReasoningState {
  const stepsBefore = trace.trajectory
    .slice(0, index)
    .map((t) => t.step) as ReadonlyArray<ReasoningStep>;
  const observationsBefore = trace.trajectory
    .slice(0, index)
    .map((t) => t.observation)
    .filter((o): o is NonNullable<typeof o> => o !== null);
  return Object.freeze({
    intentKind: trace.intentKind,
    steps: Object.freeze(stepsBefore),
    observations: Object.freeze(observationsBefore),
    depth: index,
    terminal: false,
  });
}

export function collectLabeledExamples(
  input: LabelCollectorInput,
): ReadonlyArray<PrmTrainingExample> {
  if (input.trace.outcomeLabel === null) return Object.freeze([]);
  const out: Array<PrmTrainingExample> = [];
  for (const r of input.ratios) {
    const entry = input.trace.trajectory[r.stepIndex];
    if (!entry) continue;
    const label: 0 | 1 =
      r.completerAgreementRatio >= input.positiveThreshold ? 1 : 0;
    const seed = `${input.trace.id}#${String(r.stepIndex)}`;
    out.push(
      Object.freeze({
        id: input.idOf(seed),
        tenantId: input.trace.tenantId,
        traceId: input.trace.id,
        state: buildStateAt(input.trace, r.stepIndex),
        step: entry.step,
        label,
        completerAgreementRatio: r.completerAgreementRatio,
        derivedAt: input.nowIso,
        auditHash: input.auditHashOf(seed),
      }),
    );
  }
  return Object.freeze(out);
}
