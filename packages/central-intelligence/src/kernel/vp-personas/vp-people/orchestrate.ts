/**
 * VP People — orchestration.
 *
 * Note: `employee-coordinator` is a placeholder stub line-worker. When the
 * VP needs it and the catalogue does not have it, the gap is recorded
 * and surfaced to the MD's self-extension keystone.
 */

import {
  buildLineWorkerSpawn,
  type OwnerIntent,
  type VpCapabilityGap,
  type VpLineWorkerCatalogue,
  type VpOrchestrationPlan,
} from '../shared/vp-base.js';

export const VP_PEOPLE_LINE_WORKERS = Object.freeze([
  'vendor.onboarding',
  'employee-coordinator', // STUB — will be missing in most envs
  'payroll-prep',
  'retention.strategist',
] as const);

export type PeopleLineWorker = (typeof VP_PEOPLE_LINE_WORKERS)[number];

interface PeopleRoute {
  readonly lineWorker: PeopleLineWorker;
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

export function routePeopleIntent(intent: OwnerIntent): ReadonlyArray<PeopleRoute> {
  const t = intent.text.toLowerCase();
  const routes: PeopleRoute[] = [];

  if (/vendor|contractor|supplier|onboard vendor|kyc vendor/.test(t)) {
    routes.push({
      lineWorker: 'vendor.onboarding',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Run the vendor onboarding checklist',
    });
  }
  if (/employee|staff|hire|onboard employee|terminate|fire/.test(t)) {
    routes.push({
      lineWorker: 'employee-coordinator',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Coordinate employee lifecycle (stub)',
    });
  }
  if (/payroll|salary|pay run|wage|stipend/.test(t)) {
    routes.push({
      lineWorker: 'payroll-prep',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Prepare payroll for owner review — no disbursement',
    });
  }
  if (/retain|retention|attrition|leaving|quit|resign/.test(t)) {
    routes.push({
      lineWorker: 'retention.strategist',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Score retention risk and propose a play',
    });
  }

  if (
    (intent.kind === 'status-check' || intent.kind === 'weekly-report-request') &&
    routes.length === 0
  ) {
    for (const lw of VP_PEOPLE_LINE_WORKERS) {
      routes.push({
        lineWorker: lw,
        initialInput: { mode: 'status', correlationId: intent.correlationId },
        description: `Status pull from ${lw}`,
      });
    }
  }

  return Object.freeze(routes);
}

export async function orchestratePeople(args: {
  readonly intent: OwnerIntent;
  readonly catalogue: VpLineWorkerCatalogue;
}): Promise<VpOrchestrationPlan> {
  const { intent, catalogue } = args;
  const routes = routePeopleIntent(intent);

  if (routes.length === 0) {
    return Object.freeze({
      vpName: 'vp.people',
      intentKind: intent.kind,
      rationale: 'No people signal in the message.',
      spawns: Object.freeze([]),
      gaps: Object.freeze([]),
      summary:
        'I did not find a vendor, employee, payroll, or retention signal in your note.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP People needed ${route.lineWorker} for intent "${intent.text}".`,
        suggestedRiskTier: route.lineWorker === 'payroll-prep' ? 'mutate' : 'read',
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
    vpName: 'vp.people',
    intentKind: intent.kind,
    rationale: `Routing to ${spawns.length} people line-worker(s); ${gaps.length} capability gap(s) recorded.`,
    spawns: Object.freeze(spawns),
    gaps: Object.freeze(gaps),
  });
}
