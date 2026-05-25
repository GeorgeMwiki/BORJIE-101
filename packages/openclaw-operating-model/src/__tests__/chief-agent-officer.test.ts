import { describe, expect, it } from 'vitest';
import {
  caoComplianceReport,
  caoDashboardSnapshot,
  caoRiskHeatmap,
  SHIPPED_DOMAINS,
  type AgentDecisionAudit,
  type AgentSpec,
  type KillSwitch,
  type KillSwitchState,
} from '../index.js';

function makeAgent(id: string, supportedDomains: string[]): AgentSpec {
  return {
    agentId: id,
    name: `Agent ${id}`,
    description: 'test',
    supportedDomains,
    defaultAutonomyByDomain: new Map(),
    costPerCallUsdCents: 10,
    version: '1.0.0',
  };
}

function makeDecision(
  agentId: string,
  domainId: string,
  hoursAgo: number,
  overrides: Partial<AgentDecisionAudit> = {},
): AgentDecisionAudit {
  const now = new Date('2026-05-24T12:00:00Z').getTime();
  return {
    auditId: `${agentId}-${domainId}-${hoursAgo}`,
    agentId,
    tenantId: 'org-1',
    domainId,
    action: 'test',
    autonomyLevel: 'L3',
    policyDecision: 'allow',
    outcome: 'success',
    costUsdCents: 5,
    latencyMs: 100,
    createdAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

describe('chief-agent-officer / caoDashboardSnapshot', () => {
  it('reports active/paused/killed counts', async () => {
    const agents = [
      makeAgent('a', ['rent-collection']),
      makeAgent('b', ['rent-collection']),
      makeAgent('c', ['marketing-content']),
    ];
    const state: Record<string, KillSwitchState> = {
      a: 'active',
      b: 'paused',
      c: 'killed',
    };
    const dashboard = await caoDashboardSnapshot({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents,
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [],
        resolveAgentState: (id) => state[id] ?? 'active',
      },
    });
    expect(dashboard.widgets.agentsActive).toBe(1);
    expect(dashboard.widgets.agentsPaused).toBe(1);
    expect(dashboard.widgets.agentsKilled).toBe(1);
  });

  it('counts decisions in 24h vs 30d windows', async () => {
    const decisions = [
      makeDecision('a', 'rent-collection', 1, { costUsdCents: 10 }),
      makeDecision('a', 'rent-collection', 12, { costUsdCents: 20 }),
      makeDecision('a', 'rent-collection', 25, { costUsdCents: 30 }), // outside 24h
      makeDecision('a', 'rent-collection', 24 * 31, { costUsdCents: 40 }), // outside 30d
    ];
    const dashboard = await caoDashboardSnapshot({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', ['rent-collection'])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions,
        resolveAgentState: () => 'active',
      },
    });
    expect(dashboard.widgets.decisionsLast24h).toBe(2);
    expect(dashboard.widgets.monthlySpendUsdCents).toBe(60); // 10 + 20 + 30, not 40
  });

  it('detects amber when any agent paused', async () => {
    const dashboard = await caoDashboardSnapshot({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [],
        resolveAgentState: () => 'paused',
      },
    });
    expect(dashboard.widgets.killSwitchReadiness).toBe('amber');
  });

  it('reports red when global kill is in effect', async () => {
    const ks: KillSwitch[] = [
      {
        scope: 'global',
        state: 'killed',
        reason: 'emergency',
        triggeredBy: 'cao',
        triggeredAt: '2026-05-24T11:30:00Z',
        autoTriggered: true,
      },
    ];
    const dashboard = await caoDashboardSnapshot({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: ks,
        decisions: [],
        resolveAgentState: () => 'killed',
      },
    });
    expect(dashboard.widgets.killSwitchReadiness).toBe('red');
  });

  it('groups decisions by autonomy level', async () => {
    const decisions = [
      makeDecision('a', 'rent-collection', 1, { autonomyLevel: 'L2' }),
      makeDecision('a', 'rent-collection', 2, { autonomyLevel: 'L2' }),
      makeDecision('a', 'rent-collection', 3, { autonomyLevel: 'L4' }),
    ];
    const dashboard = await caoDashboardSnapshot({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions,
        resolveAgentState: () => 'active',
      },
    });
    expect(dashboard.widgets.autonomyBreakdown.L2).toBe(2);
    expect(dashboard.widgets.autonomyBreakdown.L4).toBe(1);
    expect(dashboard.widgets.autonomyBreakdown.L0).toBe(0);
  });
});

describe('chief-agent-officer / caoComplianceReport', () => {
  it('produces a SOC2 report with at least one satisfied control', () => {
    const report = caoComplianceReport({
      framework: 'SOC2',
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [],
        resolveAgentState: () => 'active',
      },
    });
    expect(report.framework).toBe('SOC2');
    expect(report.mappings.length).toBeGreaterThan(0);
    expect(report.summary.satisfied + report.summary.partial).toBeGreaterThan(0);
  });

  it('NIST-AI-RMF report includes GOVERN/MAP/MEASURE/MANAGE controls', () => {
    const report = caoComplianceReport({
      framework: 'NIST-AI-RMF',
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [makeDecision('a', 'rent-collection', 1)],
        resolveAgentState: () => 'active',
      },
    });
    const ids = report.mappings.map((m) => m.controlId);
    expect(ids).toEqual(
      expect.arrayContaining(['GOVERN-1.1', 'MAP-2.3', 'MEASURE-2.7', 'MANAGE-2.4']),
    );
    expect(report.summary.satisfied).toBeGreaterThan(0);
  });

  it('EU-AI-Act report covers Art 9 / 12 / 14', () => {
    const report = caoComplianceReport({
      framework: 'EU-AI-Act',
      inputs: {
        orgId: 'org-1',
        agents: [makeAgent('a', [])],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [
          makeDecision('a', 'rent-collection', 1, { outcome: 'escalated' }),
        ],
        resolveAgentState: () => 'active',
      },
    });
    const ids = report.mappings.map((m) => m.controlId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'Art-9-Risk-Management',
        'Art-12-Record-Keeping',
        'Art-14-Human-Oversight',
      ]),
    );
  });

  it('ISO27001 report runs', () => {
    const report = caoComplianceReport({
      framework: 'ISO27001',
      inputs: {
        orgId: 'org-1',
        agents: [],
        domains: [],
        killSwitches: [],
        decisions: [],
        resolveAgentState: () => 'active',
      },
    });
    expect(report.framework).toBe('ISO27001');
    expect(report.mappings.length).toBeGreaterThan(0);
  });
});

describe('chief-agent-officer / caoRiskHeatmap', () => {
  it('emits at least one cell per shipped domain (default autonomy)', () => {
    const heatmap = caoRiskHeatmap({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [],
        resolveAgentState: () => 'active',
      },
    });
    // Each of 10 domains gets at least its default-autonomy cell
    expect(heatmap.cells.length).toBeGreaterThanOrEqual(SHIPPED_DOMAINS.length);
    for (const domain of SHIPPED_DOMAINS) {
      expect(
        heatmap.cells.some(
          (c) =>
            c.domainId === domain.id &&
            c.autonomyLevel === domain.defaultAutonomyLevel,
        ),
      ).toBe(true);
    }
  });

  it('higher risk class × higher autonomy → higher heat', () => {
    const heatmap = caoRiskHeatmap({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [],
        resolveAgentState: () => 'active',
      },
    });
    const critical = heatmap.cells.find(
      (c) => c.riskClass === 'critical' && c.autonomyLevel === 'L2',
    );
    const lowRisk = heatmap.cells.find(
      (c) => c.riskClass === 'low' && c.autonomyLevel === 'L4',
    );
    expect(critical).toBeDefined();
    expect(lowRisk).toBeDefined();
    // Critical × L2 still scores higher than low × L4 because the
    // risk weight dominates the autonomy weight in our heat formula.
    expect(critical!.heat).toBeGreaterThan(lowRisk!.heat);
  });

  it('decisions in last 24h surface in cells with active agent count', () => {
    const heatmap = caoRiskHeatmap({
      now: () => new Date('2026-05-24T12:00:00Z'),
      inputs: {
        orgId: 'org-1',
        agents: [],
        domains: [...SHIPPED_DOMAINS],
        killSwitches: [],
        decisions: [
          makeDecision('a', 'payment-reconciliation', 1, { autonomyLevel: 'L2' }),
          makeDecision('b', 'payment-reconciliation', 2, { autonomyLevel: 'L2' }),
        ],
        resolveAgentState: () => 'active',
      },
    });
    const cell = heatmap.cells.find(
      (c) =>
        c.domainId === 'payment-reconciliation' && c.autonomyLevel === 'L2',
    );
    expect(cell?.activeAgents).toBe(2);
    expect(cell?.decisionsLast24h).toBe(2);
  });
});
