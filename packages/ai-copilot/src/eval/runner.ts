/**
 * Eval Runner
 *
 * Executes a set of Scenarios against a live Orchestrator and produces a
 * structured report. Designed to be called from a test file (vitest) OR from
 * a standalone script. Not a vitest test itself — that way CI can choose
 * which models / providers to run it against.
 */

import { Orchestrator } from '../orchestrator/orchestrator.js';
import { AITenantContext, AIActor } from '../types/core.types.js';
import { VisibilityViewer } from '../thread/visibility.js';
import { Scenario, ScenarioResult, evaluateScenario } from './scenario.js';
import { TurnResult } from '../orchestrator/orchestrator.js';
import { logger } from '../logger.js';

export interface EvalRunOptions {
  orchestrator: Orchestrator;
  tenant: AITenantContext;
  actor: AIActor;
  viewer: VisibilityViewer;
  /** Subset of scenario ids. If absent, runs all. */
  only?: string[];
  /** Stop on first failure — useful in CI. */
  bail?: boolean;
}

export interface EvalRunReport {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: ScenarioResult[];
  /** Aggregate token usage across all scenarios. */
  tokensTotal: number;
  /** Advisor consultation rate across scenarios. */
  advisorRate: number;
}

/**
 * Run a list of scenarios against an orchestrator and return a report.
 *
 * Contract: scenarios run sequentially to avoid tenant-scoped race conditions
 * in the in-memory thread store. For production-scale eval, use a fresh
 * thread store per scenario.
 */
export async function runScenarios(
  scenarios: Scenario[],
  opts: EvalRunOptions
): Promise<EvalRunReport> {
  const filtered = opts.only
    ? scenarios.filter((s) => opts.only!.includes(s.id))
    : scenarios;

  const start = Date.now();
  const results: ScenarioResult[] = [];
  let tokensTotal = 0;
  let advisorTurns = 0;
  let totalTurns = 0;

  for (const scenario of filtered) {
    const turnResults: TurnResult[] = [];
    let threadId: string | null = null;

    for (let i = 0; i < scenario.turns.length; i++) {
      const t = scenario.turns[i];
      if (t === undefined) continue;
      if (i === 0) {
        const started = await opts.orchestrator.startThread({
          tenant: opts.tenant,
          actor: opts.actor,
          viewer: opts.viewer,
          initialUserText: t.userText,
          ...(t.forcePersonaId !== undefined ? { forcePersonaId: t.forcePersonaId } : {}),
          title: scenario.name,
        });
        if (started.success) {
          threadId = started.data.thread.id;
          turnResults.push(started.data.turn);
        } else {
          const err = (started as { success: false; error: { message: string } }).error;
          turnResults.push({
            threadId: 'none',
            finalPersonaId: 'none',
            responseText: `ERROR: ${err.message}`,
            toolCalls: [],
            handoffs: [],
            advisorConsulted: false,
            tokensUsed: 0,
            timeMs: 0,
          });
          break;
        }
      } else if (threadId) {
        const r = await opts.orchestrator.handleTurn({
          threadId,
          tenant: opts.tenant,
          actor: opts.actor,
          userText: t.userText,
          viewer: opts.viewer,
          ...(t.forcePersonaId !== undefined ? { forcePersonaId: t.forcePersonaId } : {}),
        });
        if (r.success) {
          turnResults.push(r.data);
        } else {
          const err = (r as { success: false; error: { message: string } }).error;
          turnResults.push({
            threadId,
            finalPersonaId: 'none',
            responseText: `ERROR: ${err.message}`,
            toolCalls: [],
            handoffs: [],
            advisorConsulted: false,
            tokensUsed: 0,
            timeMs: 0,
          });
        }
      }
    }

    for (const tr of turnResults) {
      tokensTotal += tr.tokensUsed;
      totalTurns += 1;
      if (tr.advisorConsulted) advisorTurns += 1;
    }

    const result = evaluateScenario(scenario, turnResults);
    results.push(result);
    if (opts.bail && !result.passed) break;
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    durationMs: Date.now() - start,
    results,
    tokensTotal,
    advisorRate: totalTurns ? advisorTurns / totalTurns : 0,
  };
}

/**
 * Pretty-print an EvalRunReport to stdout (CI-friendly).
 */
export function printReport(report: EvalRunReport): void {
  logger.info(`Eval: ${report.passed}/${report.total} passed (${report.failed} failed) in ${report.durationMs}ms`);
  logger.info(`Tokens: ${report.tokensTotal} total | Advisor rate: ${(report.advisorRate * 100).toFixed(1)}%`);
  for (const r of report.results) {
    if (r.passed) {
      logger.info(`  ✓ ${r.scenarioId}`);
    } else {
      logger.info(`  ✗ ${r.scenarioId}`);
      for (const f of r.failures) logger.info(`      - ${f}`);
    }
  }
}
