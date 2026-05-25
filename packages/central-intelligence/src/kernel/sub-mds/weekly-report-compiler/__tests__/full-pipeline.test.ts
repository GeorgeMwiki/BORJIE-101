import { describe, expect, it } from 'vitest';
import { createWeeklyReportCompilerSubMd, WEEKLY_REPORT_COMPILER_NAME } from '../index.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  type ObservedEvent,
  type SubMdContext,
  type SubMdLlmPort,
} from '../../shared/sub-md-base.js';

const TENANT = 't1';

const llm: SubMdLlmPort = {
  async generate() {
    return {
      text: JSON.stringify({
        summary: 'Tighten anomaly thresholds',
        steps: [
          { id: 'thr-tight', description: 'Lower minor threshold to 3%', expectedImpact: '+5% recall' },
        ],
        predicted: { metric: 'owner-read-through-rate', value: 0.72, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-report',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

describe('report.weekly_compiler — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE', async () => {
    const sub = createWeeklyReportCompilerSubMd({ scope: { tenantId: TENANT } });
    const events: ObservedEvent[] = [
      { id: '1', topic: 'report.week-roll', tenantId: TENANT, occurredAtMs: 1, payload: { reportId: 'r1', state: 'gathered' } },
      { id: '2', topic: 'report.week-roll', tenantId: TENANT, occurredAtMs: 2, payload: { reportId: 'r1', state: 'drafted' } },
      { id: '3', topic: 'report.week-roll', tenantId: TENANT, occurredAtMs: 3, payload: { reportId: 'r1', state: 'owner-read' } },
    ];
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(3);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('weekly-report-compiler.')).toBe(true);
    expect(artifact.cronExpression).toContain('* 1');
  });

  it('exposes 4 tools', () => {
    const sub = createWeeklyReportCompilerSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('report.draft_briefing');
  });

  it('riskTier is read (pure read/draft)', () => {
    const sub = createWeeklyReportCompilerSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('read');
  });

  it('name matches', () => {
    const sub = createWeeklyReportCompilerSubMd({ scope: { tenantId: TENANT } });
    expect(sub.name).toBe(WEEKLY_REPORT_COMPILER_NAME);
  });
});
