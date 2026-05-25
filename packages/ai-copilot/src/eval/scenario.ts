/**
 * Eval Scenario contract
 *
 * Each scenario is a single turn or sequence of turns against the Brain,
 * evaluated against structural assertions (not string equality). This is
 * deliberately *not* an LLM-as-judge eval — it catches regressions in
 * routing, tool selection, visibility, and handoff discipline, which is
 * where multi-agent systems most commonly break (Anthropic research, 2025).
 *
 * Scenarios can assert:
 *  - The primary persona selected for the initial turn.
 *  - The sequence of handoffs that occurred.
 *  - Which tools were called (and, if you provide them, with what args).
 *  - Visibility scopes used.
 *  - Whether a proposed action was emitted + at what risk level.
 *  - Whether a review was requested.
 */

import { TurnResult } from '../orchestrator/orchestrator.js';

export interface ScenarioTurn {
  userText: string;
  /** Optional override persona (e.g. to test Coworker surface directly). */
  forcePersonaId?: string;
}

export interface ScenarioExpect {
  /** Which persona should own the initial turn (intent classification). */
  expectInitialPersona?: string;
  /** Handoffs that MUST have occurred, in order. */
  expectHandoffs?: Array<{ from: string; to: string }>;
  /** Tool calls that MUST have been made. */
  expectToolCalls?: string[];
  /** Proposed action with at-least risk level. */
  expectProposedAction?: {
    riskAtLeast?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    verbRegex?: string;
  };
  /** Whether the advisor should have been consulted. */
  expectAdvisorConsulted?: boolean;
  /** Upper bound on total tokens used (cost control). */
  maxTokens?: number;
}

export interface Scenario {
  id: string;
  name: string;
  category:
    | 'leasing'
    | 'maintenance'
    | 'finance'
    | 'compliance'
    | 'communications'
    | 'migration'
    | 'coworker'
    | 'governance';
  turns: ScenarioTurn[];
  expect: ScenarioExpect;
  /** Tags for reporting. */
  tags?: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  passed: boolean;
  failures: string[];
  turnResults: TurnResult[];
}

const RISK_ORDER: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Evaluate a single scenario result against its expectations.
 */
export function evaluateScenario(
  scenario: Scenario,
  turnResults: TurnResult[]
): ScenarioResult {
  const failures: string[] = [];
  const first = turnResults[0];
  const last = turnResults[turnResults.length - 1];

  if (scenario.expect.expectInitialPersona && first) {
    const actual = first.finalPersonaId;
    // Note: if a handoff happened, finalPersonaId != initial persona. Check
    // the first handoff's source as the "initial" persona.
    const initialActual = first.handoffs.length
      ? first.handoffs[0].from
      : actual;
    if (initialActual !== scenario.expect.expectInitialPersona) {
      failures.push(
        `expected initial persona ${scenario.expect.expectInitialPersona}, got ${initialActual}`
      );
    }
  }

  if (scenario.expect.expectHandoffs && first) {
    const actual = first.handoffs.map((h) => `${h.from}->${h.to}`).join(',');
    const expected = scenario.expect.expectHandoffs
      .map((h) => `${h.from}->${h.to}`)
      .join(',');
    if (!actual.includes(expected)) {
      failures.push(
        `expected handoffs to include [${expected}], got [${actual}]`
      );
    }
  }

  if (scenario.expect.expectToolCalls && first) {
    const actualTools = new Set(first.toolCalls.map((t) => t.tool));
    for (const tool of scenario.expect.expectToolCalls) {
      if (!actualTools.has(tool)) {
        failures.push(`expected tool call ${tool}, not observed`);
      }
    }
  }

  if (scenario.expect.expectProposedAction && last) {
    const pa = last.proposedAction;
    if (!pa) {
      failures.push(`expected a PROPOSED_ACTION but none was emitted`);
    } else {
      if (scenario.expect.expectProposedAction.riskAtLeast) {
        const expected =
          RISK_ORDER[scenario.expect.expectProposedAction.riskAtLeast];
        const got = RISK_ORDER[pa.riskLevel];
        if (got < expected) {
          failures.push(
            `expected risk >= ${scenario.expect.expectProposedAction.riskAtLeast}, got ${pa.riskLevel}`
          );
        }
      }
      if (scenario.expect.expectProposedAction.verbRegex) {
        const re = new RegExp(
          scenario.expect.expectProposedAction.verbRegex,
          'i'
        );
        if (!re.test(pa.verb)) {
          failures.push(
            `expected verb matching /${scenario.expect.expectProposedAction.verbRegex}/, got "${pa.verb}"`
          );
        }
      }
    }
  }

  if (scenario.expect.expectAdvisorConsulted !== undefined && last) {
    if (last.advisorConsulted !== scenario.expect.expectAdvisorConsulted) {
      failures.push(
        `expected advisorConsulted=${scenario.expect.expectAdvisorConsulted}, got ${last.advisorConsulted}`
      );
    }
  }

  if (scenario.expect.maxTokens !== undefined) {
    const total = turnResults.reduce((s, t) => s + t.tokensUsed, 0);
    if (total > scenario.expect.maxTokens) {
      failures.push(
        `token budget exceeded: ${total} > ${scenario.expect.maxTokens}`
      );
    }
  }

  return {
    scenarioId: scenario.id,
    passed: failures.length === 0,
    failures,
    turnResults,
  };
}
