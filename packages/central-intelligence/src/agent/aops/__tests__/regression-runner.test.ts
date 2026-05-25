/**
 * Regression-runner tests — pass-rate computation against historical
 * transcripts. Verifies the threshold mechanic the canary-bridge relies on.
 */

import { describe, expect, it } from 'vitest';
import { createAOPRunner, type AOPExecutor } from '../aop-runner.js';
import { createRegressionRunner, scoreTranscript } from '../regression-runner.js';
import type { AOPSpec, RegressionSet } from '../aop-spec.js';

function fixedSpec(): AOPSpec {
  return {
    id: 'triage',
    version: 'v1',
    systemPrompt: 'be precise',
    tools: ['lookupArrears'],
    model: { provider: 'anthropic', name: 'claude-opus-4-7' },
    regressionSetId: 'rs-1',
    ownedBy: 'platform',
    createdAt: new Date(0).toISOString(),
  } as AOPSpec;
}

function executorReturning(
  table: Record<string, { finalOutput: string; toolCalls?: Array<{ toolName: string; ok: boolean }> }>,
): AOPExecutor {
  return {
    async execute(_spec, request) {
      const row = table[request.userMessage];
      if (!row) throw new Error(`no canned response for ${request.userMessage}`);
      return {
        finalOutput: row.finalOutput,
        toolCalls: (row.toolCalls ?? []).map((c) => ({
          toolName: c.toolName,
          input: {},
          output: null,
          ok: c.ok,
          durationMs: 1,
        })),
      };
    },
  };
}

describe('scoreTranscript — substring + signals', () => {
  const trace = {
    aopId: 'triage',
    aopVersion: 'v1',
    userMessage: 'q',
    finalOutput: 'arrears 250 USD; cited:lease-123',
    toolCalls: [
      { toolName: 'lookupArrears', input: { leaseId: 'lease-123' }, output: 250, ok: true, durationMs: 1 },
    ],
    ok: true,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    latencyMs: 1,
  } as const;

  it('passes when substring + signals match', () => {
    const res = scoreTranscript(
      { id: 't1', userMessage: 'q', expectedAnswerSubstring: 'arrears 250', expectedSignals: ['cited:lease-123', 'lookupArrears'] },
      trace,
    );
    expect(res.passed).toBe(true);
  });

  it('fails when substring missing', () => {
    const res = scoreTranscript(
      { id: 't1', userMessage: 'q', expectedAnswerSubstring: 'never appears', expectedSignals: [] },
      trace,
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toMatch(/missing expected substring/);
  });

  it('fails when expected signal missing', () => {
    const res = scoreTranscript(
      { id: 't1', userMessage: 'q', expectedSignals: ['cited:lease-999'] },
      trace,
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toMatch(/missing expected signal/);
  });
});

describe('RegressionRunner — pass-rate threshold', () => {
  it('returns 1.0 pass-rate when every transcript matches', async () => {
    const executor = executorReturning({
      'arrears for tenant A?': { finalOutput: 'arrears 250', toolCalls: [{ toolName: 'lookupArrears', ok: true }] },
      'arrears for tenant B?': { finalOutput: 'arrears 0', toolCalls: [{ toolName: 'lookupArrears', ok: true }] },
    });
    const runner = createAOPRunner({ executor });
    const regRunner = createRegressionRunner({ runner });
    const set: RegressionSet = {
      id: 'rs-1',
      transcripts: [
        { id: 't1', userMessage: 'arrears for tenant A?', expectedAnswerSubstring: 'arrears 250', expectedSignals: ['lookupArrears'] },
        { id: 't2', userMessage: 'arrears for tenant B?', expectedAnswerSubstring: 'arrears 0', expectedSignals: ['lookupArrears'] },
      ],
    } as RegressionSet;

    const report = await regRunner.run(fixedSpec(), set);
    expect(report.passRate).toBe(1);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
  });

  it('returns 0.5 when half pass', async () => {
    const executor = executorReturning({
      'q1': { finalOutput: 'good', toolCalls: [{ toolName: 'tool-a', ok: true }] },
      'q2': { finalOutput: 'wrong answer', toolCalls: [{ toolName: 'tool-a', ok: true }] },
    });
    const runner = createAOPRunner({ executor });
    const regRunner = createRegressionRunner({ runner });
    const set: RegressionSet = {
      id: 'rs-1',
      transcripts: [
        { id: 't1', userMessage: 'q1', expectedAnswerSubstring: 'good', expectedSignals: [] },
        { id: 't2', userMessage: 'q2', expectedAnswerSubstring: 'right answer', expectedSignals: [] },
      ],
    } as RegressionSet;

    const report = await regRunner.run(fixedSpec(), set);
    expect(report.passRate).toBe(0.5);
  });

  it('marks tool-call failures as failing transcripts', async () => {
    const executor: AOPExecutor = {
      async execute() {
        return {
          finalOutput: 'partial',
          toolCalls: [
            { toolName: 'lookupArrears', input: {}, output: null, ok: false, errorMessage: 'boom', durationMs: 1 },
          ],
        };
      },
    };
    const runner = createAOPRunner({ executor });
    const regRunner = createRegressionRunner({ runner });
    const set: RegressionSet = {
      id: 'rs-1',
      transcripts: [{ id: 't1', userMessage: 'q', expectedSignals: [] }],
    } as RegressionSet;

    const report = await regRunner.run(fixedSpec(), set);
    expect(report.passRate).toBe(0);
    expect(report.results[0]?.reason).toMatch(/trace failed/);
  });

  it('handles empty regression set as 1.0 pass-rate', async () => {
    const executor = executorReturning({});
    const runner = createAOPRunner({ executor });
    const regRunner = createRegressionRunner({ runner });
    const report = await regRunner.run(fixedSpec(), { id: 'rs-empty', transcripts: [] } as RegressionSet);
    expect(report.passRate).toBe(1);
    expect(report.total).toBe(0);
  });
});
