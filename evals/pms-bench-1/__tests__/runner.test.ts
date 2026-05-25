/**
 * runner.test.ts — end-to-end test of the PMS-bench-1 driver against the
 * deterministic mock LLM.
 *
 * Verifies:
 *   1. The mock LLM produces parseable JSON plans for every canned task.
 *   2. The sub-MD adapter wires those plans into ObservedRun shape.
 *   3. The scorers + composer produce a pass for every fixture (the canned
 *      plans are hand-crafted to score >= 0.8 across all 50 fixtures).
 *   4. The SLO stream emits 4 events per run (one per scorer).
 *   5. Tier-B/C scenarios (arrears, kra-filing, lease-renewal) are now
 *      canned and pass^k under the mock, completing the bench matrix.
 */

import { describe, it, expect } from 'vitest';
import { createMockLlm, getCannedPlanForTask } from '../runner/mock-llm.js';
import { runSubMd } from '../runner/sub-md-adapter.js';
import { loadFixtures, listScenarios, runTask } from '../runner/run-bench.js';
import type { BenchSloEvent, SloStreamWriter } from '../runner/slo-stream-writer.js';

function createMemorySloWriter(): {
  writer: SloStreamWriter;
  events: BenchSloEvent[];
} {
  const events: BenchSloEvent[] = [];
  const writer: SloStreamWriter = Object.freeze({
    outputPath: '(memory)',
    async emit(event: BenchSloEvent): Promise<void> {
      events.push(event);
    },
  });
  return { writer, events };
}

describe('pms-bench-1 runner — mock-llm end-to-end', () => {
  it('mock LLM produces parseable canned plans for every maintenance + complaint fixture', async () => {
    const llm = createMockLlm();
    const fixtures = [
      ...(await loadFixtures('maintenance-dispatch')),
      ...(await loadFixtures('complaint-triage')),
    ];
    expect(fixtures.length).toBe(20);

    for (const fixture of fixtures) {
      const result = await runSubMd({ fixture, llm, seed: 0 });
      expect(result.parseOk).toBe(true);
      expect(result.subMd).not.toBeNull();
      expect(result.observed.actions.length).toBeGreaterThan(0);
      expect((result.observed.comm ?? '').length).toBeGreaterThan(20);
      expect(getCannedPlanForTask(fixture.id)).not.toBeNull();
    }
  });

  it('every maintenance.dispatch + complaint.triage task passes pass^k under the mock', async () => {
    const llm = createMockLlm();
    const { writer, events } = createMemorySloWriter();

    const passes: Array<{ id: string; scenario: string; pass: boolean; mean: number }> = [];
    for (const scenario of ['maintenance-dispatch', 'complaint-triage']) {
      const fixtures = await loadFixtures(scenario);
      for (const fixture of fixtures) {
        const summary = await runTask({ fixture, k: 3, llm, sloWriter: writer });
        const mean = summary.runs.reduce((a, r) => a + r.composite, 0) / summary.runs.length;
        passes.push({ id: summary.taskId, scenario, pass: summary.passK, mean });
      }
    }

    const failed = passes.filter((p) => !p.pass);
    expect(failed, `expected all 20 mock-LLM tasks to pass — failures: ${JSON.stringify(failed, null, 2)}`).toEqual([]);
    // 20 fixtures * k=3 runs * 4 scorers = 240 SLO events
    expect(events.length).toBe(20 * 3 * 4);
    // Every event has a non-empty subMd + a valid metric
    for (const e of events) {
      expect(e.subMd === 'maintenance.dispatch' || e.subMd === 'complaint.triage').toBe(true);
      expect(['resolution-quality', 'task-completion-rate', 'owner-cs-score', 'cost-per-resolution']).toContain(
        e.metric,
      );
      expect(Number.isFinite(e.actualValue)).toBe(true);
      expect(Number.isFinite(e.delta)).toBe(true);
    }
  });

  it('Tier-B/C scenarios resolve to a sub-MD and pass^k under the mock', async () => {
    // After Phase F.1 + integration, the Tier-B/C scenarios are registered
    // in SUPPORTED_SCENARIOS. Canned plans for all 30 Tier-B/C fixtures
    // landed in the Phase F follow-up — every task must now pass^k under
    // the deterministic mock so the bench reports the full 50-fixture
    // matrix as green.
    const llm = createMockLlm();
    const { writer } = createMemorySloWriter();
    const supportedNow: Record<string, string> = {
      'arrears-triage': 'arrears.chaser',
      'kra-filing': 'kra.filing_assistant',
      'lease-renewal': 'lease.coordinator',
    };

    const failures: Array<{ id: string; passCount: number; mean: number }> = [];
    for (const [scenario, expectedSubMd] of Object.entries(supportedNow)) {
      const fixtures = await loadFixtures(scenario);
      expect(fixtures.length).toBe(10);
      for (const fixture of fixtures) {
        const summary = await runTask({ fixture, k: 3, llm, sloWriter: writer });
        expect(summary.subMd).toBe(expectedSubMd);
        // Mock-LLM has canned plans for every fixture, so pass^k must be true.
        if (!summary.passK) {
          const mean =
            summary.runs.reduce((a, r) => a + r.composite, 0) / summary.runs.length;
          failures.push({ id: summary.taskId, passCount: summary.passCount, mean });
        }
      }
    }
    expect(
      failures,
      `expected all 30 Tier-B/C mock-LLM tasks to pass^k — failures: ${JSON.stringify(failures, null, 2)}`,
    ).toEqual([]);
  });

  it('all 50 fixtures across all 5 scenarios pass^k under the mock', async () => {
    // Sanity: roll-up assertion that the full bench matrix is green under
    // the deterministic mock — guards against regressions in any canned
    // plan or scorer weighting.
    const llm = createMockLlm();
    const { writer } = createMemorySloWriter();
    const allScenarios = await listScenarios();
    const failures: string[] = [];
    let total = 0;
    for (const scenario of allScenarios) {
      const fixtures = await loadFixtures(scenario);
      for (const fixture of fixtures) {
        total += 1;
        const summary = await runTask({ fixture, k: 3, llm, sloWriter: writer });
        if (!summary.passK) failures.push(summary.taskId);
      }
    }
    expect(total).toBe(50);
    expect(failures, `mock-LLM pass^k failures: ${failures.join(', ')}`).toEqual([]);
  });

  it('listScenarios returns all 5 scenarios', async () => {
    const scenarios = await listScenarios();
    const set = new Set(scenarios);
    expect(set.has('arrears-triage')).toBe(true);
    expect(set.has('maintenance-dispatch')).toBe(true);
    expect(set.has('complaint-triage')).toBe(true);
    expect(set.has('kra-filing')).toBe(true);
    expect(set.has('lease-renewal')).toBe(true);
  });

  it('cost-per-resolution event reports observed cost cents (not the [0,1] score)', async () => {
    const llm = createMockLlm();
    const { writer, events } = createMemorySloWriter();
    const fixtures = await loadFixtures('maintenance-dispatch');
    const first = fixtures[0];
    if (first === undefined) throw new Error('fixtures missing');
    await runTask({ fixture: first, k: 1, llm, sloWriter: writer });
    const costEvents = events.filter((e) => e.metric === 'cost-per-resolution');
    expect(costEvents.length).toBe(1);
    const ce = costEvents[0];
    if (ce === undefined) throw new Error('cost event missing');
    expect(ce.actualValue).toBeGreaterThan(0);
    expect(ce.actualValue).toBeLessThanOrEqual(50); // sanity: cents
  });
});
