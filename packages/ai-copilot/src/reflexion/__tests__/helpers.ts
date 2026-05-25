/**
 * Shared test helpers — Reflexion (Phase E P8 Gap 7).
 */

import type {
  CotStep,
  CotTrace,
  JudgeVerdict,
  TurnOutcome,
  TurnOutcomeRecord,
} from '../types.js';

let traceCounter = 0;

export function buildTrace(overrides: Partial<CotTrace> = {}): CotTrace {
  traceCounter += 1;
  const defaults: CotTrace = {
    traceId: overrides.traceId ?? `trc_${traceCounter}`,
    tenantId: overrides.tenantId ?? 't1',
    taskTag: overrides.taskTag ?? 'maintenance.triage',
    steps: overrides.steps ?? [
      { index: 0, thought: 'Inspect work order' },
      { index: 1, thought: 'Call search tool', tool: 'kb.search', observation: 'no match' },
      { index: 2, thought: 'Draft response' },
    ],
    capturedAt: overrides.capturedAt ?? '2026-05-23T10:00:00.000Z',
  };
  return defaults;
}

export function buildStep(overrides: Partial<CotStep> = {}): CotStep {
  return {
    index: overrides.index ?? 0,
    thought: overrides.thought ?? 'think',
    ...(overrides.tool !== undefined ? { tool: overrides.tool } : {}),
    ...(overrides.observation !== undefined ? { observation: overrides.observation } : {}),
  };
}

export function buildOutcome(outcome: TurnOutcome = 'failure'): TurnOutcomeRecord {
  return { outcome };
}

export function buildVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    score: overrides.score ?? 0.45,
    verdict: overrides.verdict ?? 'fail',
    ...(overrides.rationale !== undefined ? { rationale: overrides.rationale } : {}),
  };
}
