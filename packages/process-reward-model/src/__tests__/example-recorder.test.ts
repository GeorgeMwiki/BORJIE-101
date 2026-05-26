import { describe, expect, it } from 'vitest';

import { buildReasoningTraceRecord } from '../training/example-recorder.js';
import { collectLabeledExamples } from '../training/label-collector.js';
import { buildMctsAuditPayload } from '../audit/audit-chain-link.js';
import {
  createAggregatorPrm,
  AGGREGATOR_LEARNED_CONFIDENCE_FLOOR,
} from '../prm/prm-aggregator.js';
import {
  createLearnedPrmStub,
  loadLearnedPrm,
  LEARNED_PRM_MIN_TRAINING_FLOOR,
} from '../prm/learned-prm-stub.js';
import { heuristicPrm } from '../prm/heuristic-prm.js';
import type {
  Observation,
  PrmContext,
  ReasoningState,
  ReasoningStep,
  ReasoningTraceRecord,
} from '../types.js';

const ctx: PrmContext = Object.freeze({
  tenantId: 't1',
  scopeKind: null,
  scopeId: null,
  autonomyTier: 1,
  killswitchActive: false,
  domainHints: Object.freeze({}),
});

const step: ReasoningStep = Object.freeze({
  id: 's-1',
  kind: 'tool_call' as const,
  toolName: 'noop',
  args: Object.freeze({ citations: ['d'] }),
  rationale: 'r',
});

const obs: Observation = Object.freeze({
  stepId: 's-1',
  success: true,
  summary: 'ok',
  schemaValid: true,
});

const state: ReasoningState = Object.freeze({
  intentKind: 'file',
  steps: Object.freeze([]),
  observations: Object.freeze([]),
  depth: 0,
  terminal: false,
});

describe('buildReasoningTraceRecord', () => {
  it('builds a frozen record with null outcome label', () => {
    const r = buildReasoningTraceRecord({
      draft: {
        tenantId: 't1',
        sessionId: 'sess',
        turnId: 'turn',
        intentKind: 'file',
        trajectory: [{ step, observation: obs }],
      },
      id: 'rec-1',
      capturedAt: '2026-05-26T00:00:00Z',
      auditHash: 'hash-1',
    });
    expect(r.outcomeLabel).toBeNull();
    expect(r.outcomeSource).toBeNull();
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.trajectory).toHaveLength(1);
  });
});

describe('collectLabeledExamples', () => {
  const labeledTrace: ReasoningTraceRecord = Object.freeze({
    id: 'rec-1',
    tenantId: 't1',
    sessionId: 'sess',
    turnId: 'turn',
    intentKind: 'file',
    trajectory: Object.freeze([{ step, observation: obs }]),
    outcomeLabel: 1,
    outcomeSource: 'regulator_portal' as const,
    capturedAt: '2026-05-26T00:00:00Z',
    labeledAt: '2026-05-27T00:00:00Z',
    auditHash: 'h',
  });

  it('emits a positive example above the threshold', () => {
    const out = collectLabeledExamples({
      trace: labeledTrace,
      ratios: [{ stepIndex: 0, completerAgreementRatio: 0.9 }],
      positiveThreshold: 0.6,
      nowIso: '2026-05-27T00:00:00Z',
      auditHashOf: (s) => `h:${s}`,
      idOf: (s) => `ex:${s}`,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe(1);
  });

  it('emits a negative example below the threshold', () => {
    const out = collectLabeledExamples({
      trace: labeledTrace,
      ratios: [{ stepIndex: 0, completerAgreementRatio: 0.1 }],
      positiveThreshold: 0.6,
      nowIso: '2026-05-27T00:00:00Z',
      auditHashOf: () => 'h',
      idOf: () => 'ex',
    });
    expect(out[0]?.label).toBe(0);
  });

  it('returns no examples when the trace is unlabeled', () => {
    const unlabeled: ReasoningTraceRecord = Object.freeze({
      ...labeledTrace,
      outcomeLabel: null,
    });
    const out = collectLabeledExamples({
      trace: unlabeled,
      ratios: [{ stepIndex: 0, completerAgreementRatio: 0.9 }],
      positiveThreshold: 0.6,
      nowIso: '2026-05-27T00:00:00Z',
      auditHashOf: () => 'h',
      idOf: () => 'ex',
    });
    expect(out).toHaveLength(0);
  });
});

describe('buildMctsAuditPayload', () => {
  it('emits a frozen mcts_reasoning_search payload', () => {
    const p = buildMctsAuditPayload({
      tenantId: 't1',
      turnId: 'turn-1',
      intentKind: 'file',
      rolloutsRun: 16,
      bestValue: 0.85,
      terminatedReason: 'confident_root_choice',
      selectedPathHash: 'sha-1',
      treeSize: 23,
      wallMs: 240,
      timestampIso: '2026-05-26T00:00:00Z',
    });
    expect(p.kind).toBe('mcts_reasoning_search');
    expect(p.payload.tenant_id).toBe('t1');
    expect(p.payload.rollouts_run).toBe(16);
    expect(Object.isFrozen(p)).toBe(true);
  });
});

describe('PRM aggregator', () => {
  it('falls back to the heuristic when no candidate clears the confidence floor', () => {
    const learnedHandle = loadLearnedPrm('s3://nowhere');
    const learnedStub = createLearnedPrmStub(learnedHandle);
    const agg = createAggregatorPrm(heuristicPrm, [learnedStub]);
    const out = agg({
      state,
      candidateStep: step,
      context: ctx,
    });
    const heur = heuristicPrm({ state, candidateStep: step, context: ctx });
    expect(out.score).toBeCloseTo(heur.score, 5);
  });

  it('confidence floor is the documented 0.6', () => {
    expect(AGGREGATOR_LEARNED_CONFIDENCE_FLOOR).toBe(0.6);
  });

  it('learned-PRM minimum training floor is 200', () => {
    expect(LEARNED_PRM_MIN_TRAINING_FLOOR).toBe(200);
  });
});
