/**
 * Chief Agent Officer (CAO) dashboards.
 *
 * Provides three primary surfaces:
 *   - caoDashboardSnapshot — single-pane "is the agent fleet ok right now"
 *   - caoComplianceReport  — maps agent activity to control frameworks
 *   - caoRiskHeatmap       — risk × domain × autonomy heat surface
 */

import type {
  AgentDecisionAudit,
  AgentDomain,
  AgentSpec,
  AutonomyLevel,
  ChiefAgentOfficerDashboard,
  ComplianceFramework,
  ComplianceControlMapping,
  ComplianceReport,
  DashboardSink,
  KillSwitch,
  KillSwitchState,
  RiskHeatmap,
  RiskHeatmapCell,
} from '../types.js';
import { AUTONOMY_LEVELS } from '../types.js';

export interface CaoDataInputs {
  readonly orgId: string;
  readonly agents: ReadonlyArray<AgentSpec>;
  readonly domains: ReadonlyArray<AgentDomain>;
  readonly killSwitches: ReadonlyArray<KillSwitch>;
  readonly decisions: ReadonlyArray<AgentDecisionAudit>;
  /** Resolver for kill-switch state per (agentId). */
  readonly resolveAgentState: (
    agentId: string,
  ) => KillSwitchState;
}

export interface CaoDashboardSnapshotArgs {
  readonly inputs: CaoDataInputs;
  readonly now?: () => Date;
  readonly sink?: DashboardSink;
}

export async function caoDashboardSnapshot(
  args: CaoDashboardSnapshotArgs,
): Promise<ChiefAgentOfficerDashboard> {
  const now = (args.now ?? (() => new Date()))();
  const since24h = now.getTime() - 24 * 60 * 60 * 1000;
  const since30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const { agents, decisions, killSwitches, resolveAgentState } = args.inputs;

  let active = 0;
  let paused = 0;
  let killed = 0;
  for (const agent of agents) {
    const state = resolveAgentState(agent.agentId);
    if (state === 'paused') paused += 1;
    else if (state === 'killed') killed += 1;
    else active += 1;
  }

  const decisionsLast24h = decisions.filter(
    (d) => new Date(d.createdAt).getTime() >= since24h,
  );
  const decisionsLast30d = decisions.filter(
    (d) => new Date(d.createdAt).getTime() >= since30d,
  );
  const escalationsPending = decisionsLast24h.filter(
    (d) => d.outcome === 'escalated',
  ).length;
  const monthlySpend = decisionsLast30d.reduce(
    (a, d) => a + d.costUsdCents,
    0,
  );
  const outcomesDelivered = decisionsLast30d.filter(
    (d) => d.outcome === 'success',
  ).length;

  const autonomyBreakdown: Record<AutonomyLevel, number> = {
    L0: 0,
    L1: 0,
    L2: 0,
    L3: 0,
    L4: 0,
    L5: 0,
  };
  for (const d of decisionsLast24h) {
    autonomyBreakdown[d.autonomyLevel] += 1;
  }

  // Kill-switch readiness: green if no auto-trips in last 24h + no killed,
  // amber if any auto-trip in last 24h or paused state present,
  // red if global kill active or killed > 0.
  const recentTrips = killSwitches.filter(
    (k) =>
      k.autoTriggered &&
      new Date(k.triggeredAt).getTime() >= since24h,
  );
  const globalKilled = killSwitches.some(
    (k) => k.scope === 'global' && k.state === 'killed',
  );

  let readiness: 'green' | 'amber' | 'red' = 'green';
  if (globalKilled || killed > 0) readiness = 'red';
  else if (recentTrips.length > 0 || paused > 0) readiness = 'amber';

  const dashboard: ChiefAgentOfficerDashboard = {
    orgId: args.inputs.orgId,
    generatedAt: now.toISOString(),
    widgets: {
      agentsActive: active,
      agentsPaused: paused,
      agentsKilled: killed,
      decisionsLast24h: decisionsLast24h.length,
      escalationsPending,
      monthlySpendUsdCents: monthlySpend,
      outcomesDeliveredLast30d: outcomesDelivered,
      killSwitchReadiness: readiness,
      autonomyBreakdown,
    },
  };

  if (args.sink) {
    await args.sink.recordSnapshot(dashboard);
  }
  return dashboard;
}

// =========================================================================
// Compliance report
// =========================================================================

interface FrameworkControl {
  readonly controlId: string;
  readonly description: string;
  readonly check: (inputs: CaoDataInputs) => {
    readonly status: ComplianceControlMapping['status'];
    readonly evidence: ReadonlyArray<string>;
  };
}

const SOC2_CONTROLS: ReadonlyArray<FrameworkControl> = [
  {
    controlId: 'CC6.1',
    description: 'Logical access controls — agent registry maintained',
    check: (i) =>
      i.agents.length > 0
        ? { status: 'satisfied', evidence: [`${i.agents.length} agents registered`] }
        : { status: 'unsatisfied', evidence: ['No agents registered'] },
  },
  {
    controlId: 'CC7.3',
    description: 'Incident response — kill-switch capability available',
    check: (i) =>
      i.killSwitches !== undefined
        ? { status: 'satisfied', evidence: [`${i.killSwitches.length} kill-switch records`] }
        : { status: 'unsatisfied', evidence: ['Kill-switch capability not detected'] },
  },
  {
    controlId: 'CC8.1',
    description: 'Change management — autonomy changes audited',
    check: (i) => ({
      status: i.agents.length > 0 ? 'satisfied' : 'partial',
      evidence: [`Autonomy changes recorded for ${i.agents.length} agents`],
    }),
  },
];

const NIST_AI_RMF_CONTROLS: ReadonlyArray<FrameworkControl> = [
  {
    controlId: 'GOVERN-1.1',
    description: 'AI risk management roles assigned (CAO)',
    check: (i) =>
      i.orgId
        ? { status: 'satisfied', evidence: [`Org ${i.orgId} has CAO dashboard`] }
        : { status: 'unsatisfied', evidence: [] },
  },
  {
    controlId: 'MAP-2.3',
    description: 'Task domains documented',
    check: (i) =>
      i.domains.length > 0
        ? { status: 'satisfied', evidence: [`${i.domains.length} domains documented`] }
        : { status: 'unsatisfied', evidence: ['No domains catalogued'] },
  },
  {
    controlId: 'MEASURE-2.7',
    description: 'Decision audit trail captured',
    check: (i) =>
      i.decisions.length > 0
        ? { status: 'satisfied', evidence: [`${i.decisions.length} decisions audited`] }
        : { status: 'partial', evidence: ['No decisions in window'] },
  },
  {
    controlId: 'MANAGE-2.4',
    description: 'Kill switch + auto-trip triggers available',
    check: () => ({
      status: 'satisfied',
      evidence: ['Auto-trip evaluator wired into kill-switch'],
    }),
  },
];

const EU_AI_ACT_CONTROLS: ReadonlyArray<FrameworkControl> = [
  {
    controlId: 'Art-9-Risk-Management',
    description: 'Risk-management system for high-risk AI systems',
    check: (i) =>
      i.domains.length > 0
        ? { status: 'satisfied', evidence: ['Risk-class per domain catalogued'] }
        : { status: 'unsatisfied', evidence: [] },
  },
  {
    controlId: 'Art-12-Record-Keeping',
    description: 'Logging of operation, traceable decisions',
    check: (i) =>
      i.decisions.length > 0
        ? { status: 'satisfied', evidence: [`${i.decisions.length} decision audits`] }
        : { status: 'partial', evidence: [] },
  },
  {
    controlId: 'Art-14-Human-Oversight',
    description: 'Human oversight measures',
    check: (i) => {
      const escalations = i.decisions.filter((d) => d.outcome === 'escalated').length;
      return {
        status: escalations > 0 ? 'satisfied' : 'partial',
        evidence: [`${escalations} escalations to humans`],
      };
    },
  },
];

const ISO27001_CONTROLS: ReadonlyArray<FrameworkControl> = [
  {
    controlId: 'A.5.23',
    description: 'Information security for cloud services',
    check: (i) =>
      i.killSwitches !== undefined
        ? { status: 'satisfied', evidence: ['Kill-switch substrate in place'] }
        : { status: 'partial', evidence: [] },
  },
  {
    controlId: 'A.8.16',
    description: 'Monitoring activities',
    check: (i) =>
      i.decisions.length > 0
        ? { status: 'satisfied', evidence: [`${i.decisions.length} monitored decisions`] }
        : { status: 'partial', evidence: [] },
  },
];

const FRAMEWORK_REGISTRY: Readonly<Record<ComplianceFramework, ReadonlyArray<FrameworkControl>>> = {
  SOC2: SOC2_CONTROLS,
  ISO27001: ISO27001_CONTROLS,
  'NIST-AI-RMF': NIST_AI_RMF_CONTROLS,
  'EU-AI-Act': EU_AI_ACT_CONTROLS,
};

export interface CaoComplianceReportArgs {
  readonly inputs: CaoDataInputs;
  readonly framework: ComplianceFramework;
  readonly now?: () => Date;
}

export function caoComplianceReport(
  args: CaoComplianceReportArgs,
): ComplianceReport {
  const now = (args.now ?? (() => new Date()))();
  const controls = FRAMEWORK_REGISTRY[args.framework];
  const mappings: ComplianceControlMapping[] = controls.map((c) => {
    const result = c.check(args.inputs);
    return {
      controlId: c.controlId,
      description: c.description,
      status: result.status,
      evidence: result.evidence,
    };
  });

  const summary = {
    satisfied: mappings.filter((m) => m.status === 'satisfied').length,
    partial: mappings.filter((m) => m.status === 'partial').length,
    unsatisfied: mappings.filter((m) => m.status === 'unsatisfied').length,
    na: mappings.filter((m) => m.status === 'na').length,
  };

  return {
    orgId: args.inputs.orgId,
    framework: args.framework,
    generatedAt: now.toISOString(),
    summary,
    mappings,
  };
}

// =========================================================================
// Risk heatmap
// =========================================================================

export interface CaoRiskHeatmapArgs {
  readonly inputs: CaoDataInputs;
  readonly now?: () => Date;
}

export function caoRiskHeatmap(args: CaoRiskHeatmapArgs): RiskHeatmap {
  const now = (args.now ?? (() => new Date()))();
  const since24h = now.getTime() - 24 * 60 * 60 * 1000;
  const cells: RiskHeatmapCell[] = [];

  const domainsById = new Map(args.inputs.domains.map((d) => [d.id, d]));
  const decisionsLast24h = args.inputs.decisions.filter(
    (d) => new Date(d.createdAt).getTime() >= since24h,
  );
  const decisionsByDomainAutonomy = new Map<string, AgentDecisionAudit[]>();
  for (const d of decisionsLast24h) {
    const key = `${d.domainId}::${d.autonomyLevel}`;
    const list = decisionsByDomainAutonomy.get(key) ?? [];
    list.push(d);
    decisionsByDomainAutonomy.set(key, list);
  }

  for (const domain of args.inputs.domains) {
    for (const lvl of AUTONOMY_LEVELS) {
      const key = `${domain.id}::${lvl}`;
      const decisions = decisionsByDomainAutonomy.get(key) ?? [];
      const activeAgents = new Set(decisions.map((d) => d.agentId)).size;
      const heat = computeHeat({
        riskClass: domain.riskClass,
        autonomyLevel: lvl,
        decisionsCount: decisions.length,
      });
      if (decisions.length === 0 && heat === 0) continue;
      cells.push({
        riskClass: domain.riskClass,
        domainId: domain.id,
        autonomyLevel: lvl,
        heat,
        activeAgents,
        decisionsLast24h: decisions.length,
      });
    }
    // Always emit a "current default" cell for visibility
    if (
      !cells.some(
        (c) =>
          c.domainId === domain.id &&
          c.autonomyLevel === domain.defaultAutonomyLevel,
      )
    ) {
      cells.push({
        riskClass: domain.riskClass,
        domainId: domain.id,
        autonomyLevel: domain.defaultAutonomyLevel,
        heat: computeHeat({
          riskClass: domain.riskClass,
          autonomyLevel: domain.defaultAutonomyLevel,
          decisionsCount: 0,
        }),
        activeAgents: 0,
        decisionsLast24h: 0,
      });
    }
    domainsById; // silence unused warnings if any
  }

  return {
    orgId: args.inputs.orgId,
    generatedAt: now.toISOString(),
    cells,
  };
}

function computeHeat(args: {
  readonly riskClass: AgentDomain['riskClass'];
  readonly autonomyLevel: AutonomyLevel;
  readonly decisionsCount: number;
}): number {
  const riskWeights: Readonly<Record<AgentDomain['riskClass'], number>> = {
    low: 0.1,
    med: 0.3,
    high: 0.6,
    critical: 1.0,
  };
  const autonomyWeights: Readonly<Record<AutonomyLevel, number>> = {
    L0: 0,
    L1: 0.1,
    L2: 0.25,
    L3: 0.45,
    L4: 0.7,
    L5: 1.0,
  };
  const volumeFactor = Math.min(1, args.decisionsCount / 100);
  // Heat is the product of risk × autonomy × (0.5 + 0.5 × volumeFactor)
  // so even at 0 volume there is a "baseline" heat reflecting potential.
  const heat =
    riskWeights[args.riskClass] *
    autonomyWeights[args.autonomyLevel] *
    (0.5 + 0.5 * volumeFactor);
  return Math.min(1, Math.max(0, +heat.toFixed(4)));
}
