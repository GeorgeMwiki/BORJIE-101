/**
 * VP Risk & Compliance — orchestration.
 *
 * Most line-workers here are stubs in the bootstrap path; the
 * compliance.filing-monitor / insurance.coordinator / dispute.mediator
 * triple should be exercised through the self-extension keystone when
 * the catalogue does not have them.
 */

import {
  buildLineWorkerSpawn,
  type OwnerIntent,
  type VpCapabilityGap,
  type VpLineWorkerCatalogue,
  type VpOrchestrationPlan,
} from '../shared/vp-base.js';

export const VP_RISK_COMPLIANCE_LINE_WORKERS = Object.freeze([
  'compliance.filing-monitor', // NEW stub
  'insurance.coordinator', // stub
  'dispute.mediator', // stub
  'audit.preparer',
] as const);

export type RiskComplianceLineWorker = (typeof VP_RISK_COMPLIANCE_LINE_WORKERS)[number];

interface RcRoute {
  readonly lineWorker: RiskComplianceLineWorker;
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

export function routeRiskComplianceIntent(intent: OwnerIntent): ReadonlyArray<RcRoute> {
  const t = intent.text.toLowerCase();
  const routes: RcRoute[] = [];

  if (/filing|deadline|return|compliance window|regulator|county/.test(t)) {
    routes.push({
      lineWorker: 'compliance.filing-monitor',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Check the regulatory filing calendar for upcoming windows',
    });
  }
  if (/insurance|policy|premium|cover/.test(t)) {
    routes.push({
      lineWorker: 'insurance.coordinator',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Track insurance policy renewals and gaps',
    });
  }
  if (/dispute|lawsuit|claim|small claims|tribunal|mediation/.test(t)) {
    routes.push({
      lineWorker: 'dispute.mediator',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Triage the dispute and draft mediation talking points',
    });
  }
  if (/audit|prep|external audit|review/.test(t)) {
    routes.push({
      lineWorker: 'audit.preparer',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Compile audit-ready evidence pack',
    });
  }

  if (
    (intent.kind === 'status-check' || intent.kind === 'weekly-report-request') &&
    routes.length === 0
  ) {
    for (const lw of VP_RISK_COMPLIANCE_LINE_WORKERS) {
      routes.push({
        lineWorker: lw,
        initialInput: { mode: 'status', correlationId: intent.correlationId },
        description: `Status pull from ${lw}`,
      });
    }
  }

  return Object.freeze(routes);
}

export async function orchestrateRiskCompliance(args: {
  readonly intent: OwnerIntent;
  readonly catalogue: VpLineWorkerCatalogue;
}): Promise<VpOrchestrationPlan> {
  const { intent, catalogue } = args;
  const routes = routeRiskComplianceIntent(intent);

  if (routes.length === 0) {
    return Object.freeze({
      vpName: 'vp.risk-compliance',
      intentKind: intent.kind,
      rationale: 'No risk or compliance signal in the message.',
      spawns: Object.freeze([]),
      gaps: Object.freeze([]),
      summary:
        'I did not find a filing, insurance, dispute, or audit signal in your note.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP Risk & Compliance needed ${route.lineWorker} for intent "${intent.text}".`,
        suggestedRiskTier:
          route.lineWorker === 'compliance.filing-monitor' ? 'external-comm' : 'read',
      });
      continue;
    }
    spawns.push(
      buildLineWorkerSpawn({
        subMdId: route.lineWorker,
        scope: intent.scope,
        initialInput: route.initialInput,
        description: route.description,
        persona: route.lineWorker,
      }),
    );
  }

  return Object.freeze({
    vpName: 'vp.risk-compliance',
    intentKind: intent.kind,
    rationale: `Routing to ${spawns.length} risk/compliance line-worker(s); ${gaps.length} capability gap(s) recorded.`,
    spawns: Object.freeze(spawns),
    gaps: Object.freeze(gaps),
  });
}
