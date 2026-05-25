#!/usr/bin/env node

/**
 * Eval runner — executes ALL_SCENARIOS against a configured Brain.
 *
 * Two modes:
 *
 *  1. Mock mode (default, what CI runs).  Uses MockAIProvider. Scenarios
 *     are executed to verify the orchestrator state machine does not
 *     crash: intent router + tool dispatcher + thread store + handoff
 *     bounding. Content assertions (PROPOSED_ACTION, handoff targets,
 *     tool calls) are ignored because the mock provider emits static
 *     JSON — that's an LLM-quality check which runs separately with
 *     a real Anthropic key.
 *
 *  2. Live mode (when ANTHROPIC_API_KEY is set).  Uses the real
 *     AnthropicProvider; all structural assertions fire.
 *
 * Exit 0 on success; non-zero when any scenario crashes in mock mode OR
 * any assertion fails in live mode.
 */

import { createBrain, createBrainForTesting } from '../brain.js';
import { logger } from '../logger.js';
import { ALL_SCENARIOS } from './index.js';
import { runScenarios, printReport } from './runner.js';
import type { EvalRunReport } from './runner.js';

async function main() {
  const liveMode = Boolean(process.env.ANTHROPIC_API_KEY);

  // In mock mode we don't need the full env (no Supabase, no DB). Construct
  // a test brain directly so the eval can run against a fresh, isolated
  // state on every CI run.
  const brain = liveMode
    ? createBrain({
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
        // Eval uses the in-memory thread store — this is a synthetic run
        // against a synthetic tenant; nothing persists.
        threadStoreBackend: (await import('../thread/thread-store.js'))
          .InMemoryThreadStore.prototype.constructor.call(
            Object.create(
              (await import('../thread/thread-store.js')).InMemoryThreadStore.prototype
            )
          ) as unknown as ConstructorParameters<
            typeof import('../brain.js')['BrainRegistry']
          >[0] extends never
            ? never
            : never,
      })
    : createBrainForTesting();

  logger.info(
    `Brain eval — ${ALL_SCENARIOS.length} scenarios, mode=${liveMode ? 'live' : 'mock'}`
  );

  let report: EvalRunReport;
  try {
    report = await runScenarios(ALL_SCENARIOS, {
      orchestrator: brain.orchestrator,
      tenant: {
        tenantId: 'eval',
        tenantName: 'Eval Tenant',
        environment: 'development',
      },
      actor: {
        type: 'user',
        id: 'eval-user',
        roles: ['admin', 'manager'],
      },
      viewer: {
        userId: 'eval-user',
        roles: ['admin', 'manager'],
        teamIds: [],
        isAdmin: true,
        isManagement: true,
      },
    });
  } catch (err) {
    logger.error('eval-runner crashed during scenario execution', { error: err });
    process.exit(2);
  }

  printReport(report);

  if (liveMode) {
    // Strict: every assertion must pass.
    process.exit(report.failed > 0 ? 1 : 0);
  }

  // Mock mode: the only real failure is a scenario that threw. Assertion
  // mismatches are expected (mock provider can't emit PROPOSED_ACTION or
  // handoff directives). We consider the gate passed when no scenario
  // threw during execution — the state machine is healthy.
  const crashed = report.results.filter((r) =>
    r.turnResults.some((t) =>
      t.responseText.startsWith('ERROR:')
    )
  );
  if (crashed.length > 0) {
    logger.error(`${crashed.length} scenario(s) crashed`);
    for (const c of crashed) {
      logger.error(`  ✗ ${c.scenarioId}`);
    }
    process.exit(1);
  }
  logger.info(
    `Mock-mode gate: all ${report.total} scenarios executed without crash.`
  );
  process.exit(0);
}

void main().catch((err) => {
  logger.error('eval-runner fatal', { error: err });
  process.exit(2);
});
