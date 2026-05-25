import { describe, it, expect } from 'vitest';
import { runPlanExecute, InMemoryAuditSink } from '../index.js';
import type {
  ExecutionRecord,
  MultiLlmRequest,
  MultiLlmResponse,
  MultiLlmSynthesizer,
  Step,
  StepExecutor,
} from '../types.js';

/**
 * Stub synthesizer that returns pre-canned plan/verifier responses in
 * call-order. The orchestrator queries planner → verifier (→ replanner
 * → verifier ...) so the queue mirrors that interaction.
 */
function makeSynthesizer(scripted: ReadonlyArray<string>): MultiLlmSynthesizer {
  let i = 0;
  return {
    async synthesize(_req: MultiLlmRequest): Promise<MultiLlmResponse> {
      const text = scripted[i] ?? '';
      i++;
      return {
        text,
        modelsQueried: 3,
        modelsAgreed: 3,
        converged: true,
        perModel: [],
      };
    },
  };
}

function makeExecutor(behavior: 'all-succeed' | 'all-fail'): StepExecutor {
  return {
    async execute(step: Step): Promise<ExecutionRecord> {
      const now = new Date().toISOString();
      return {
        stepId: step.id,
        toolName: step.toolName,
        status: behavior === 'all-succeed' ? 'completed' : 'failed',
        startedAt: now,
        finishedAt: now,
        latencyMs: 1,
        output: behavior === 'all-succeed' ? { ok: true } : null,
        error: behavior === 'all-fail' ? 'mock error' : null,
        citations: [],
      };
    },
  };
}

const toolDir = [
  { name: 'lookup_lease', description: 'look up a lease by id' },
  { name: 'send_notice', description: 'queue a notice for delivery' },
];

const planAB = JSON.stringify({
  steps: [
    { id: 'a', description: 'lookup', toolName: 'lookup_lease', input: {} },
    { id: 'b', description: 'notify', toolName: 'send_notice', input: {} },
  ],
  deps: [['a', 'b']],
  planCitations: [],
});

const verifierSuccess = JSON.stringify({
  goalAchieved: true,
  confidence: 0.9,
  evidence: [],
  deltas: [],
  summary: 'done',
});

const verifierFail = JSON.stringify({
  goalAchieved: false,
  confidence: 0.2,
  evidence: [],
  deltas: [{ description: 'notice never sent' }],
  summary: 'not yet',
});

describe('runPlanExecute', () => {
  it('happy path: plan → execute → verify → goal achieved', async () => {
    const synth = makeSynthesizer([planAB, verifierSuccess]);
    const audit = new InMemoryAuditSink();
    const result = await runPlanExecute({
      goal: 'send a lease renewal notice',
      toolDirectory: toolDir,
      synthesizer: synth,
      executor: makeExecutor('all-succeed'),
      audit,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('goal-achieved');
    expect(result.records).toHaveLength(2);
    const trail = await audit.list();
    expect(trail.some((e) => e.kind === 'goal_achieved')).toBe(true);
  });

  it('re-plans on verifier failure then succeeds on the second pass', async () => {
    const synth = makeSynthesizer([planAB, verifierFail, planAB, verifierSuccess]);
    const audit = new InMemoryAuditSink();
    const result = await runPlanExecute({
      goal: 'send a lease renewal notice',
      toolDirectory: toolDir,
      synthesizer: synth,
      executor: makeExecutor('all-succeed'),
      audit,
      config: { maxReplans: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trail = await audit.list();
    expect(trail.some((e) => e.kind === 'plan_replanned')).toBe(true);
  });

  it('abandons when maxReplans is exceeded without goal achievement', async () => {
    // planner returns same plan twice; verifier always fails.
    const synth = makeSynthesizer([planAB, verifierFail, planAB, verifierFail]);
    const audit = new InMemoryAuditSink();
    const result = await runPlanExecute({
      goal: 'send a lease renewal notice',
      toolDirectory: toolDir,
      synthesizer: synth,
      executor: makeExecutor('all-succeed'),
      audit,
      config: { maxReplans: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('goal-abandoned');
    const trail = await audit.list();
    expect(trail.some((e) => e.kind === 'goal_abandoned')).toBe(true);
  });

  it('returns planner-error when planner produces unparseable JSON', async () => {
    const synth = makeSynthesizer(['not json']);
    const result = await runPlanExecute({
      goal: 'g',
      toolDirectory: toolDir,
      synthesizer: synth,
      executor: makeExecutor('all-succeed'),
      audit: new InMemoryAuditSink(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe('planner-error');
  });
});
