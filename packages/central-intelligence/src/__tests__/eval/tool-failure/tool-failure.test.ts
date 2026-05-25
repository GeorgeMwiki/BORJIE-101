/**
 * Tool-failure eval tests — Phase D / D12.2.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_FAILURE_SCENARIOS,
  type ToolFailureScenario,
} from './scenarios.js';
import {
  runToolFailureScenario,
  runToolFailureSuite,
} from './tool-failure-runner.js';

describe('central-intelligence — tool-failure eval', () => {
  it('corpus is non-empty and ids unique', () => {
    expect(TOOL_FAILURE_SCENARIOS.length).toBeGreaterThanOrEqual(15);
    const ids = new Set<string>();
    for (const s of TOOL_FAILURE_SCENARIOS) {
      expect(s.id).toMatch(/^tf\./);
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      ids.add(s.id);
    }
  });

  it('all four recovery modes are represented', () => {
    const recoveries = new Set(
      TOOL_FAILURE_SCENARIOS.map((s) => s.expectedRecovery),
    );
    expect(recoveries.has('retry-then-succeed')).toBe(true);
    expect(recoveries.has('fallback-to-alternate')).toBe(true);
    expect(recoveries.has('surface-failure-to-user')).toBe(true);
    expect(recoveries.has('abort-gracefully-with-audit')).toBe(true);
  });

  it('every fallback scenario declares a fallback tool', () => {
    for (const s of TOOL_FAILURE_SCENARIOS) {
      if (s.expectedRecovery === 'fallback-to-alternate') {
        expect(
          s.fallbackTool,
          `${s.id} declares fallback recovery but no fallbackTool`,
        ).not.toBeNull();
      }
    }
  });

  it('every surface / abort scenario declares a user-facing substring', () => {
    for (const s of TOOL_FAILURE_SCENARIOS) {
      if (
        s.expectedRecovery === 'surface-failure-to-user' ||
        s.expectedRecovery === 'abort-gracefully-with-audit'
      ) {
        expect(
          s.mustSurfaceSubstring,
          `${s.id} declares surface/abort but no mustSurfaceSubstring`,
        ).not.toBeNull();
      }
    }
  });

  it('every scenario passes its recovery contract', () => {
    const outcome = runToolFailureSuite(TOOL_FAILURE_SCENARIOS);
    const failing = outcome.results.filter((r) => !r.pass);
    if (failing.length > 0) {
      const lines = failing.map(
        (r) => `  • [${r.scenarioId}] ${r.failures.join('; ')}`,
      );
      throw new Error(
        `${failing.length}/${outcome.results.length} tool-failure scenario(s) failed:\n${lines.join('\n')}`,
      );
    }
    expect(outcome.summary.passed).toBe(TOOL_FAILURE_SCENARIOS.length);
  });

  it('synthetic surface failure with missing substring fails the contract', () => {
    const synthetic: ToolFailureScenario = {
      id: 'tf.synthetic.missing-substring',
      description: 'synthetic — surface recovery but the runner cannot find a substring',
      goal: 'do thing',
      failingTool: 'x.do',
      failureMode: 'returns-ok-false',
      expectedRecovery: 'surface-failure-to-user',
      fallbackTool: null,
      maxRetries: 0,
      mustSurfaceSubstring: 'this-precise-string-never-appears',
    };
    const result = runToolFailureScenario(synthetic);
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('user message should contain');
  });

  it('abort-with-audit synthetic produces an audit row', () => {
    const synthetic: ToolFailureScenario = {
      id: 'tf.synthetic.abort-audit',
      description: 'synthetic abort + audit',
      goal: 'do gated thing',
      failingTool: 'gate.check',
      failureMode: 'returns-ok-false',
      expectedRecovery: 'abort-gracefully-with-audit',
      fallbackTool: null,
      maxRetries: 0,
      mustSurfaceSubstring: 'aborted',
    };
    const result = runToolFailureScenario(synthetic);
    expect(result.auditRows).toBe(1);
  });
});
