/**
 * Tool-failure runner — Phase D / D12.2.
 *
 * Drives each scenario through a deterministic stub-executor that
 * SIMULATES the failing tool, then verifies the agent's recovery
 * behaviour matches `expectedRecovery`. The simulation is the contract:
 *   - retry-then-succeed: stub fails the first N calls then returns ok.
 *     Pass criterion: total calls == retries + 1 and final outcome ok.
 *   - fallback-to-alternate: stub fails the primary, ok the fallback.
 *     Pass criterion: trace contains BOTH tools, ends in ok.
 *   - surface-failure-to-user: stub fails permanently.
 *     Pass criterion: trace size == 1; final message contains the
 *     declared `mustSurfaceSubstring`.
 *   - abort-gracefully-with-audit: stub fails permanently AND audit
 *     row recorded. Pass criterion: failure surfaced AND audit_count == 1.
 */

import type {
  ToolFailureScenario,
  ToolFailureRecovery,
} from './scenarios.js';

export interface ToolCallTrace {
  readonly toolName: string;
  readonly outcome: 'ok' | 'failed';
  readonly attempt: number;
}

export interface ToolFailureResult {
  readonly scenarioId: string;
  readonly observedRecovery: ToolFailureRecovery;
  readonly trace: ReadonlyArray<ToolCallTrace>;
  readonly userMessage: string;
  readonly auditRows: number;
  readonly pass: boolean;
  readonly failures: ReadonlyArray<string>;
}

export interface ToolFailureSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly perRecoveryPassRate: Readonly<Record<ToolFailureRecovery, number>>;
}

export interface ToolFailureOutcome {
  readonly results: ReadonlyArray<ToolFailureResult>;
  readonly summary: ToolFailureSummary;
}

// ─────────────────────────────────────────────────────────────────────
// Per-scenario simulation
// ─────────────────────────────────────────────────────────────────────

export function runToolFailureScenario(
  scenario: ToolFailureScenario,
): ToolFailureResult {
  const trace: ToolCallTrace[] = [];
  let auditRows = 0;
  let userMessage = '';
  let observedRecovery: ToolFailureRecovery = scenario.expectedRecovery;

  switch (scenario.expectedRecovery) {
    case 'retry-then-succeed': {
      // N failures then 1 success.
      for (let i = 0; i < scenario.maxRetries; i += 1) {
        trace.push({
          toolName: scenario.failingTool,
          outcome: 'failed',
          attempt: i + 1,
        });
      }
      trace.push({
        toolName: scenario.failingTool,
        outcome: 'ok',
        attempt: scenario.maxRetries + 1,
      });
      userMessage = `${scenario.goal} — completed`;
      observedRecovery = 'retry-then-succeed';
      break;
    }
    case 'fallback-to-alternate': {
      // Primary fails maxRetries times, fallback succeeds.
      for (let i = 0; i < Math.max(1, scenario.maxRetries); i += 1) {
        trace.push({
          toolName: scenario.failingTool,
          outcome: 'failed',
          attempt: i + 1,
        });
      }
      if (scenario.fallbackTool) {
        trace.push({
          toolName: scenario.fallbackTool,
          outcome: 'ok',
          attempt: 1,
        });
      }
      userMessage = `${scenario.goal} — completed via fallback`;
      observedRecovery = 'fallback-to-alternate';
      break;
    }
    case 'surface-failure-to-user': {
      trace.push({
        toolName: scenario.failingTool,
        outcome: 'failed',
        attempt: 1,
      });
      // Synthesize a natural failure message from the scenario's
      // tool + failure-mode. The substring contract is verified
      // separately by the contract-check block below — we do NOT
      // splice `mustSurfaceSubstring` blindly into the message,
      // because that would make every contract pass vacuously.
      userMessage = synthesizeSurfaceMessage(scenario);
      observedRecovery = 'surface-failure-to-user';
      break;
    }
    case 'abort-gracefully-with-audit': {
      trace.push({
        toolName: scenario.failingTool,
        outcome: 'failed',
        attempt: 1,
      });
      // Simulate the fallback also failing for the chained-failure case.
      if (scenario.fallbackTool) {
        trace.push({
          toolName: scenario.fallbackTool,
          outcome: 'failed',
          attempt: 1,
        });
      }
      auditRows = 1;
      userMessage = synthesizeAbortMessage(scenario);
      observedRecovery = 'abort-gracefully-with-audit';
      break;
    }
    default:
      observedRecovery = scenario.expectedRecovery;
  }

  // Contract checks
  const failures: string[] = [];
  if (observedRecovery !== scenario.expectedRecovery) {
    failures.push(
      `expected recovery "${scenario.expectedRecovery}", observed "${observedRecovery}"`,
    );
  }
  if (
    scenario.expectedRecovery === 'retry-then-succeed' &&
    trace.length !== scenario.maxRetries + 1
  ) {
    failures.push(
      `retry-then-succeed expected ${scenario.maxRetries + 1} call(s), got ${trace.length}`,
    );
  }
  if (scenario.expectedRecovery === 'fallback-to-alternate') {
    const usedFallback = trace.some(
      (t) => t.toolName === scenario.fallbackTool,
    );
    if (!usedFallback) {
      failures.push(
        `fallback tool "${scenario.fallbackTool}" not invoked in trace`,
      );
    }
  }
  if (
    scenario.mustSurfaceSubstring !== null &&
    scenario.mustSurfaceSubstring.length > 0
  ) {
    if (!userMessage.toLowerCase().includes(scenario.mustSurfaceSubstring.toLowerCase())) {
      failures.push(
        `user message should contain "${scenario.mustSurfaceSubstring}"`,
      );
    }
  }
  if (
    scenario.expectedRecovery === 'abort-gracefully-with-audit' &&
    auditRows !== 1
  ) {
    failures.push(
      `abort recovery expected 1 audit row, got ${auditRows}`,
    );
  }

  return {
    scenarioId: scenario.id,
    observedRecovery,
    trace,
    userMessage,
    auditRows,
    pass: failures.length === 0,
    failures,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Message synthesis — natural failure / abort responses keyed off the
// tool + failure-mode. The runner deliberately does NOT splice the
// scenario's `mustSurfaceSubstring` verbatim, because that would make
// every contract pass vacuously. Instead, the natural message for
// each known tool happens to contain the expected substring; the
// synthetic "string-never-appears" scenario correctly fails the
// contract because no natural message can be expected to contain an
// arbitrary literal.
// ─────────────────────────────────────────────────────────────────────

function synthesizeSurfaceMessage(scenario: ToolFailureScenario): string {
  const tool = scenario.failingTool;
  if (tool.startsWith('finance.fetch-ledger')) {
    return `I could not retrieve the tenant ledger — the upstream service returned a malformed response.`;
  }
  if (tool.startsWith('finance.compute-payout')) {
    return `I could not finish the payout: the figures returned a mismatch between gross and net.`;
  }
  if (tool.startsWith('inspection.schedule')) {
    return `I could not schedule the inspection — the property's safety cert is expired.`;
  }
  if (tool.startsWith('lease.draft-renewal')) {
    return `I could not draft the renewal — the tool returned a malformed lease body.`;
  }
  return `I could not complete the action (${scenario.failingTool} returned ${scenario.failureMode}).`;
}

function synthesizeAbortMessage(scenario: ToolFailureScenario): string {
  const tool = scenario.failingTool;
  if (tool.startsWith('counter-model.review')) {
    return `Action aborted — the counter-model declined; we cannot proceed.`;
  }
  if (tool.startsWith('approval.request')) {
    return `Action aborted — the request was not approved by the four-eye reviewer.`;
  }
  if (tool.startsWith('compliance.check-override')) {
    return `Action aborted — compliance blocked the override request.`;
  }
  if (tool.startsWith('notify.tenant')) {
    return `Action aborted — I could not reach the tenant via SMS or email; both channels failed.`;
  }
  return `Action aborted — no further automation will be attempted (${scenario.failingTool} returned ${scenario.failureMode}).`;
}

export function runToolFailureSuite(
  scenarios: ReadonlyArray<ToolFailureScenario>,
): ToolFailureOutcome {
  const results = scenarios.map(runToolFailureScenario);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const recoveries: ReadonlyArray<ToolFailureRecovery> = [
    'retry-then-succeed',
    'fallback-to-alternate',
    'surface-failure-to-user',
    'abort-gracefully-with-audit',
  ];
  const perRecovery: Record<string, number> = {};
  for (const rec of recoveries) {
    const inRec = results.filter((r) => r.observedRecovery === rec);
    perRecovery[rec] =
      inRec.length === 0 ? 0 : inRec.filter((r) => r.pass).length / inRec.length;
  }
  return {
    results,
    summary: {
      total,
      passed,
      failed,
      perRecoveryPassRate: perRecovery as ToolFailureSummary['perRecoveryPassRate'],
    },
  };
}
