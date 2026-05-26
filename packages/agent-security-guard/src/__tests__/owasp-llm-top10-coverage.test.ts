/**
 * OWASP LLM Top-10 (2025) per-category coverage.
 *
 * For each category in the package's scope (LLM01/02/04/05/06/07/08/10),
 * at least one scenario must be present and at least one of those
 * scenarios must be blocked by the appropriate detector.
 *
 * Reference: https://genai.owasp.org/llm-top-10/ — OWASP Top 10 for LLM
 * Applications (2025 revision).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BUILTIN_SCENARIOS,
  createInMemoryToolRegistry,
  createRedTeamRunner,
  createToolUseCallbackFromValidator,
  createToolUseValidator,
  type OwaspLlmCategory,
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

const CATEGORIES_IN_PACKAGE_SCOPE: ReadonlyArray<OwaspLlmCategory> =
  Object.freeze([
    'LLM01',
    'LLM02',
    'LLM04',
    'LLM05',
    'LLM06',
    'LLM07',
    'LLM08',
    'LLM10',
  ]);

describe('OWASP LLM Top-10 (2025) coverage matrix', () => {
  for (const cat of CATEGORIES_IN_PACKAGE_SCOPE) {
    it(`${cat} — has at least one scenario`, () => {
      const scenarios = BUILTIN_SCENARIOS.filter(
        (s) => s.owaspCategory === cat,
      );
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
    });

    it(`${cat} — at least one scenario is BLOCKED by detectors`, () => {
      const registry = createInMemoryToolRegistry(TOOLS);
      const validator = createToolUseValidator({ registry });
      const callback = createToolUseCallbackFromValidator(validator, 't-cov');
      const runner = createRedTeamRunner({
        tenantId: 't-cov',
        scenarioLabel: `coverage-${cat}`,
        scenarios: BUILTIN_SCENARIOS.filter(
          (s) => s.owaspCategory === cat,
        ),
        toolUseCallback: callback,
      });
      const result = runner.run();
      expect(result.outcomes.some((o) => o.blocked)).toBe(true);
    });
  }
});
