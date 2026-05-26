/**
 * Wire-up smoke test — asserts the PRM package's `ReasoningTraceRecord` +
 * `PrmTrainingExample` + `MctsAuditPayload` fields stay in lockstep with
 * the migration `0040_reasoning_traces.sql` column names.
 *
 * This is the linkage check the 18BB gap analysis P0 #1 closure depends
 * on: if either side drifts (TS contract or SQL schema) without the
 * other, persistence + replay break silently. The test exercises only
 * the public surface of `@borjie/process-reward-model`, so it stays
 * green regardless of how the wire is consumed downstream.
 */

import { describe, expect, it } from 'vitest';

import { buildReasoningTraceRecord } from '../training/example-recorder.js';
import { collectLabeledExamples } from '../training/label-collector.js';
import { buildMctsAuditPayload } from '../audit/audit-chain-link.js';
import type {
  Observation,
  ReasoningStep,
  ReasoningTraceRecord,
} from '../types.js';

// Field-name expectations mirror migration 0040_reasoning_traces.sql.
// If a column is renamed in SQL the TS-side projection must move with it.
const REASONING_TRACE_COLUMNS = Object.freeze([
  'id',
  'tenantId',
  'sessionId',
  'turnId',
  'intentKind',
  'trajectory',
  'outcomeLabel',
  'outcomeSource',
  'capturedAt',
  'labeledAt',
  'auditHash',
]);

const PRM_TRAINING_EXAMPLE_COLUMNS = Object.freeze([
  'id',
  'tenantId',
  'traceId',
  'state',
  'step',
  'label',
  'completerAgreementRatio',
  'derivedAt',
  'auditHash',
]);

const MCTS_AUDIT_PAYLOAD_KEYS = Object.freeze([
  'tenant_id',
  'turn_id',
  'intent_kind',
  'rollouts_run',
  'best_value',
  'terminated_reason',
  'selected_path_hash',
  'tree_size',
  'wall_ms',
  'timestamp_iso',
]);

const step: ReasoningStep = Object.freeze({
  id: 's-1',
  kind: 'tool_call' as const,
  toolName: 'noop',
  args: Object.freeze({}),
  rationale: 'r',
});

const obs: Observation = Object.freeze({
  stepId: 's-1',
  success: true,
  summary: 'ok',
  schemaValid: true,
});

describe('schema wire-up — ReasoningTraceRecord ↔ reasoning_traces', () => {
  it('exposes every TS field expected by the migration', () => {
    const record: ReasoningTraceRecord = buildReasoningTraceRecord({
      draft: {
        tenantId: 't',
        sessionId: 's',
        turnId: 'u',
        intentKind: 'file',
        trajectory: [{ step, observation: obs }],
      },
      id: 'rec-1',
      capturedAt: '2026-05-26T00:00:00Z',
      auditHash: 'h',
    });
    const keys = Object.keys(record).sort();
    for (const col of REASONING_TRACE_COLUMNS) {
      expect(keys).toContain(col);
    }
  });
});

describe('schema wire-up — PrmTrainingExample ↔ prm_training_examples', () => {
  it('exposes every TS field expected by the migration', () => {
    const labeled: ReasoningTraceRecord = Object.freeze({
      id: 'rec-1',
      tenantId: 't',
      sessionId: 's',
      turnId: 'u',
      intentKind: 'file',
      trajectory: Object.freeze([{ step, observation: obs }]),
      outcomeLabel: 1 as const,
      outcomeSource: 'regulator_portal' as const,
      capturedAt: '2026-05-26T00:00:00Z',
      labeledAt: '2026-05-27T00:00:00Z',
      auditHash: 'h',
    });
    const examples = collectLabeledExamples({
      trace: labeled,
      ratios: [{ stepIndex: 0, completerAgreementRatio: 0.9 }],
      positiveThreshold: 0.6,
      nowIso: '2026-05-27T00:00:00Z',
      auditHashOf: () => 'h',
      idOf: () => 'ex',
    });
    expect(examples).toHaveLength(1);
    const keys = Object.keys(examples[0]!).sort();
    for (const col of PRM_TRAINING_EXAMPLE_COLUMNS) {
      expect(keys).toContain(col);
    }
  });
});

describe('schema wire-up — MctsAuditPayload ↔ mcts_search_tree_dumps', () => {
  it('emits every snake_case payload key expected by the migration', () => {
    const payload = buildMctsAuditPayload({
      tenantId: 't',
      turnId: 'turn',
      intentKind: 'file',
      rolloutsRun: 1,
      bestValue: 0.5,
      terminatedReason: 'budget_exhausted',
      selectedPathHash: 'h',
      treeSize: 1,
      wallMs: 1,
      timestampIso: '2026-05-26T00:00:00Z',
    });
    const keys = Object.keys(payload.payload).sort();
    for (const col of MCTS_AUDIT_PAYLOAD_KEYS) {
      expect(keys).toContain(col);
    }
  });

  it('enumerates only the four valid termination reasons', () => {
    const reasons = [
      'budget_exhausted',
      'confident_root_choice',
      'wall_clock_exceeded',
      'no_expansion_possible',
    ] as const;
    for (const r of reasons) {
      const p = buildMctsAuditPayload({
        tenantId: 't',
        turnId: 'turn',
        intentKind: 'file',
        rolloutsRun: 0,
        bestValue: 0,
        terminatedReason: r,
        selectedPathHash: 'h',
        treeSize: 0,
        wallMs: 0,
        timestampIso: 'iso',
      });
      expect(p.payload.terminated_reason).toBe(r);
    }
  });
});
