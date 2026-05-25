/**
 * Tests for eval/scenario evaluation logic.
 *
 * Coverage: initial persona check (with/without handoffs), handoff sequence,
 * tool-call membership, proposed action risk, advisor consulted assertion,
 * token budget cap, multi-failure aggregation, no-failures = passed.
 */

import { describe, it, expect } from 'vitest';
import { evaluateScenario, type Scenario } from '../scenario.js';
import type { TurnResult } from '../../orchestrator/orchestrator.js';

function turn(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    threadId: 'thr-1',
    finalPersonaId: 'leasing',
    responseText: 'ok',
    toolCalls: [],
    handoffs: [],
    advisorConsulted: false,
    tokensUsed: 100,
    timeMs: 50,
    ...overrides,
  };
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 's-1',
    name: 'lease quote',
    category: 'leasing',
    turns: [{ userText: 'Hi' }],
    expect: {},
    ...overrides,
  };
}

describe('evaluateScenario', () => {
  it('passes when no expectations are set', () => {
    const result = evaluateScenario(scenario(), [turn()]);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when initial persona does not match', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectInitialPersona: 'finance' } }),
      [turn({ finalPersonaId: 'leasing' })],
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join('|')).toMatch(/initial persona/);
  });

  it('uses the first handoff source as the initial persona when handoffs exist', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectInitialPersona: 'leasing' } }),
      [
        turn({
          finalPersonaId: 'finance',
          handoffs: [
            { from: 'leasing', to: 'finance', objective: 'finance check' },
          ],
        }),
      ],
    );
    expect(result.passed).toBe(true);
  });

  it('passes when expected handoff sequence is included', () => {
    const result = evaluateScenario(
      scenario({
        expect: { expectHandoffs: [{ from: 'leasing', to: 'finance' }] },
      }),
      [
        turn({
          handoffs: [
            { from: 'leasing', to: 'finance', objective: 'x' },
          ],
        }),
      ],
    );
    expect(result.passed).toBe(true);
  });

  it('fails when expected handoff is missing', () => {
    const result = evaluateScenario(
      scenario({
        expect: { expectHandoffs: [{ from: 'leasing', to: 'finance' }] },
      }),
      [turn({ handoffs: [] })],
    );
    expect(result.passed).toBe(false);
  });

  it('fails when an expected tool call was not observed', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectToolCalls: ['lookup_lease'] } }),
      [turn({ toolCalls: [{ tool: 'lookup_property', ok: true }] })],
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join('|')).toMatch(/lookup_lease/);
  });

  it('passes when expected tool call IS observed (and additional tools are fine)', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectToolCalls: ['lookup_lease'] } }),
      [
        turn({
          toolCalls: [
            { tool: 'lookup_lease', ok: true },
            { tool: 'lookup_property', ok: true },
          ],
        }),
      ],
    );
    expect(result.passed).toBe(true);
  });

  it('fails when proposed action is expected but missing', () => {
    const result = evaluateScenario(
      scenario({
        expect: { expectProposedAction: { riskAtLeast: 'HIGH' } },
      }),
      [turn()],
    );
    expect(result.passed).toBe(false);
  });

  it('fails when proposed-action risk is below the at-least floor', () => {
    const result = evaluateScenario(
      scenario({
        expect: { expectProposedAction: { riskAtLeast: 'HIGH' } },
      }),
      [
        turn({
          proposedAction: {
            verb: 'send_letter',
            object: 'tenant',
            riskLevel: 'LOW',
            reviewRequired: false,
          },
        }),
      ],
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join('|')).toMatch(/risk/);
  });

  it('passes when verb regex matches the proposed action', () => {
    const result = evaluateScenario(
      scenario({
        expect: {
          expectProposedAction: { verbRegex: '^send_' },
        },
      }),
      [
        turn({
          proposedAction: {
            verb: 'send_letter',
            object: 'tenant',
            riskLevel: 'LOW',
            reviewRequired: false,
          },
        }),
      ],
    );
    expect(result.passed).toBe(true);
  });

  it('fails when verb regex does not match', () => {
    const result = evaluateScenario(
      scenario({
        expect: {
          expectProposedAction: { verbRegex: '^terminate' },
        },
      }),
      [
        turn({
          proposedAction: {
            verb: 'send_letter',
            object: 'tenant',
            riskLevel: 'LOW',
            reviewRequired: false,
          },
        }),
      ],
    );
    expect(result.passed).toBe(false);
  });

  it('passes when advisorConsulted matches expectation', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectAdvisorConsulted: true } }),
      [turn({ advisorConsulted: true })],
    );
    expect(result.passed).toBe(true);
  });

  it('fails when advisorConsulted does not match', () => {
    const result = evaluateScenario(
      scenario({ expect: { expectAdvisorConsulted: true } }),
      [turn({ advisorConsulted: false })],
    );
    expect(result.passed).toBe(false);
  });

  it('fails when total tokens exceed maxTokens', () => {
    const result = evaluateScenario(
      scenario({ expect: { maxTokens: 100 } }),
      [turn({ tokensUsed: 80 }), turn({ tokensUsed: 80 })],
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join('|')).toMatch(/budget/);
  });

  it('passes when total tokens fit under maxTokens', () => {
    const result = evaluateScenario(
      scenario({ expect: { maxTokens: 1000 } }),
      [turn({ tokensUsed: 100 })],
    );
    expect(result.passed).toBe(true);
  });

  it('aggregates multiple failure messages', () => {
    const result = evaluateScenario(
      scenario({
        expect: {
          expectInitialPersona: 'finance',
          expectToolCalls: ['lookup_lease'],
          maxTokens: 50,
        },
      }),
      [turn({ tokensUsed: 100, toolCalls: [], finalPersonaId: 'leasing' })],
    );
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
  });
});
