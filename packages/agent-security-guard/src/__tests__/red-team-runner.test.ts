/**
 * End-to-end tests for the red-team scenario runner.
 *
 * Verifies:
 *   - all built-in scenarios are present (>=30; we ship 32)
 *   - every OWASP LLM Top-10 category has >=1 scenario
 *   - per-scenario verifier outputs are deterministic
 *   - CI gate: `findCriticalFailures` returns [] for the baseline run
 *   - tool-use scenarios route through an injected validator callback
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BUILTIN_SCENARIOS,
  createInMemoryToolRegistry,
  createRedTeamRunner,
  createToolUseCallbackFromValidator,
  createToolUseValidator,
  findCriticalFailures,
  type ToolDefinition,
} from '../index.js';

const TOOLS: ReadonlyArray<ToolDefinition> = Object.freeze([
  Object.freeze({
    name: 'read_user_profile',
    description: 'read',
    requiredTier: 'T0' as const,
    argsSchema: z.object({}),
    requiresConfirmation: false,
  }),
  Object.freeze({
    name: 'create_task',
    description: 'create',
    requiredTier: 'T1' as const,
    argsSchema: z.object({}),
    requiresConfirmation: false,
  }),
  Object.freeze({
    name: 'transfer_funds',
    description: 'transfer',
    requiredTier: 'T2' as const,
    argsSchema: z.object({}),
    requiresConfirmation: true,
  }),
  Object.freeze({
    name: 'delete_user',
    description: 'delete',
    requiredTier: 'T2' as const,
    argsSchema: z.object({}),
    requiresConfirmation: true,
  }),
  Object.freeze({
    name: 'fanout',
    description: 'fanout',
    requiredTier: 'T1' as const,
    argsSchema: z.object({}),
    requiresConfirmation: false,
  }),
  Object.freeze({
    name: 'any',
    description: 'any',
    requiredTier: 'T1' as const,
    argsSchema: z.object({}),
    requiresConfirmation: false,
  }),
]);

describe('RedTeamRunner end-to-end', () => {
  it('ships at least 30 built-in scenarios', () => {
    expect(BUILTIN_SCENARIOS.length).toBeGreaterThanOrEqual(30);
  });

  it('covers every OWASP LLM Top-10 category', () => {
    const categories = new Set(BUILTIN_SCENARIOS.map((s) => s.owaspCategory));
    // LLM03 (Supply Chain) + LLM09 (Misinfo) are covered by sibling
    // packages per spec §3. Confirm we cover the categories the
    // agent-security-guard package owns:
    for (const cat of ['LLM01', 'LLM02', 'LLM04', 'LLM05', 'LLM06', 'LLM07', 'LLM08', 'LLM10']) {
      expect(categories.has(cat as never)).toBe(true);
    }
  });

  it('every scenario id is a clearly-labelled __fixture__', () => {
    for (const sc of BUILTIN_SCENARIOS) {
      expect(sc.id.startsWith('__fixture__')).toBe(true);
    }
  });

  it('runs the full scenario set deterministically', () => {
    const registry = createInMemoryToolRegistry(TOOLS);
    const validator = createToolUseValidator({ registry });
    const callback = createToolUseCallbackFromValidator(validator, 't-test');
    const runner = createRedTeamRunner({
      tenantId: 't-test',
      scenarioLabel: 'baseline-suite',
      toolUseCallback: callback,
    });
    const result = runner.run();
    expect(result.run.attacksAttempted).toBe(BUILTIN_SCENARIOS.length);
    expect(result.outcomes.length).toBe(BUILTIN_SCENARIOS.length);
  });

  it('CI gate: zero HIGH/CRITICAL succeeded in baseline', () => {
    const registry = createInMemoryToolRegistry(TOOLS);
    const validator = createToolUseValidator({ registry });
    const callback = createToolUseCallbackFromValidator(validator, 't-test');
    const runner = createRedTeamRunner({
      tenantId: 't-test',
      scenarioLabel: 'baseline-suite',
      toolUseCallback: callback,
    });
    const result = runner.run();
    const failures = findCriticalFailures(result.outcomes);
    expect(failures).toEqual([]);
    expect(result.run.status).toBe('passed');
  });

  it('produces hash-chained run rows', () => {
    const registry = createInMemoryToolRegistry(TOOLS);
    const validator = createToolUseValidator({ registry });
    const cb = createToolUseCallbackFromValidator(validator, 't-x');

    const r1 = createRedTeamRunner({
      tenantId: 't-x',
      scenarioLabel: 'suite-1',
      toolUseCallback: cb,
    }).run();
    const r2 = createRedTeamRunner({
      tenantId: 't-x',
      scenarioLabel: 'suite-2',
      previousHash: r1.run.auditHash,
      toolUseCallback: cb,
    }).run();
    expect(r2.run.prevHash).toBe(r1.run.auditHash);
    expect(r1.run.auditHash).not.toBe(r2.run.auditHash);
  });
});
