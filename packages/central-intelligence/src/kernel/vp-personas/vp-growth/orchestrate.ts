/**
 * VP Growth — orchestration. Renewals, leasing, pricing, acquisitions.
 */

import {
  buildLineWorkerSpawn,
  type OwnerIntent,
  type VpCapabilityGap,
  type VpLineWorkerCatalogue,
  type VpOrchestrationPlan,
} from '../shared/vp-base.js';

export const VP_GROWTH_LINE_WORKERS = Object.freeze([
  'lease.coordinator',
  'leasing.after-hours-contact',
  'pricing.analyst',
  'vacancy.acquisitions-scout',
] as const);

export type GrowthLineWorker = (typeof VP_GROWTH_LINE_WORKERS)[number];

interface GrowthRoute {
  readonly lineWorker: GrowthLineWorker;
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

export function routeGrowthIntent(intent: OwnerIntent): ReadonlyArray<GrowthRoute> {
  const t = intent.text.toLowerCase();
  const routes: GrowthRoute[] = [];

  if (/renew|lease end|expir(?:e|ing|y)|new lease|sign lease/.test(t)) {
    routes.push({
      lineWorker: 'lease.coordinator',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Run the renewal / new-lease funnel',
    });
  }
  if (/after hours|late evening|night|weekend prospect|out of office/.test(t)) {
    routes.push({
      lineWorker: 'leasing.after-hours-contact',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Stand in for after-hours prospect contact (drafts only)',
    });
  }
  if (/pric(?:e|ing)|comp set|market rate|raise rent|reduce rent/.test(t)) {
    routes.push({
      lineWorker: 'pricing.analyst',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Pull comp set and produce a pricing memo',
    });
  }
  if (/acqui|buy|opportunity|seller|off-market|distressed/.test(t)) {
    routes.push({
      lineWorker: 'vacancy.acquisitions-scout',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Score the acquisition opportunity',
    });
  }

  if (
    (intent.kind === 'status-check' || intent.kind === 'weekly-report-request') &&
    routes.length === 0
  ) {
    for (const lw of VP_GROWTH_LINE_WORKERS) {
      routes.push({
        lineWorker: lw,
        initialInput: { mode: 'status', correlationId: intent.correlationId },
        description: `Status pull from ${lw}`,
      });
    }
  }

  return Object.freeze(routes);
}

export async function orchestrateGrowth(args: {
  readonly intent: OwnerIntent;
  readonly catalogue: VpLineWorkerCatalogue;
}): Promise<VpOrchestrationPlan> {
  const { intent, catalogue } = args;
  const routes = routeGrowthIntent(intent);

  if (routes.length === 0) {
    return Object.freeze({
      vpName: 'vp.growth',
      intentKind: intent.kind,
      rationale: 'No growth signal in the message.',
      spawns: Object.freeze([]),
      gaps: Object.freeze([]),
      summary:
        'I did not find a renewal, leasing, pricing, or acquisition signal in your note.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP Growth needed ${route.lineWorker} for intent "${intent.text}".`,
        suggestedRiskTier:
          route.lineWorker === 'leasing.after-hours-contact' ? 'external-comm' : 'mutate',
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
    vpName: 'vp.growth',
    intentKind: intent.kind,
    rationale: `Routing to ${spawns.length} growth line-worker(s); ${gaps.length} capability gap(s) recorded.`,
    spawns: Object.freeze(spawns),
    gaps: Object.freeze(gaps),
  });
}
