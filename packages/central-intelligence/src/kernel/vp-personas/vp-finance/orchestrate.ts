/**
 * VP Finance — orchestration. Pattern-matches owner intent against
 * the four finance line-workers and emits a SubMdSpawn plan.
 */

import {
  buildLineWorkerSpawn,
  type OwnerIntent,
  type VpCapabilityGap,
  type VpLineWorkerCatalogue,
  type VpOrchestrationPlan,
} from '../shared/vp-base.js';

export const VP_FINANCE_LINE_WORKERS = Object.freeze([
  'arrears.chaser',
  'kra.filing-assistant',
  'utility-billing-clerk',
  'cashflow-forecaster',
] as const);

export type FinanceLineWorker = (typeof VP_FINANCE_LINE_WORKERS)[number];

interface FinanceRoute {
  readonly lineWorker: FinanceLineWorker;
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

export function routeFinanceIntent(intent: OwnerIntent): ReadonlyArray<FinanceRoute> {
  const t = intent.text.toLowerCase();
  const routes: FinanceRoute[] = [];

  if (/arrears|overdue|late rent|chase|outstanding/.test(t)) {
    routes.push({
      lineWorker: 'arrears.chaser',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Run the arrears ladder for overdue accounts',
    });
  }
  if (/kra|tax|mri|withholding|filing/.test(t)) {
    routes.push({
      lineWorker: 'kra.filing-assistant',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Prepare the KRA filing — owner signs off before submission',
    });
  }
  if (/utility|water|electric|kplc|nairobi water|levy|service charge/.test(t)) {
    routes.push({
      lineWorker: 'utility-billing-clerk',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Reconcile utility bills and post tenant allocations',
    });
  }
  if (/cash ?flow|forecast|noi|projection|liquidity/.test(t)) {
    routes.push({
      lineWorker: 'cashflow-forecaster',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Refresh the rolling cashflow forecast',
    });
  }

  if (
    (intent.kind === 'status-check' || intent.kind === 'weekly-report-request') &&
    routes.length === 0
  ) {
    for (const lw of VP_FINANCE_LINE_WORKERS) {
      routes.push({
        lineWorker: lw,
        initialInput: { mode: 'status', correlationId: intent.correlationId },
        description: `Status pull from ${lw}`,
      });
    }
  }

  return Object.freeze(routes);
}

export async function orchestrateFinance(args: {
  readonly intent: OwnerIntent;
  readonly catalogue: VpLineWorkerCatalogue;
}): Promise<VpOrchestrationPlan> {
  const { intent, catalogue } = args;
  const routes = routeFinanceIntent(intent);

  if (routes.length === 0) {
    return Object.freeze({
      vpName: 'vp.finance',
      intentKind: intent.kind,
      rationale: 'No financial signal in the message; nothing to dispatch.',
      spawns: Object.freeze([]),
      gaps: Object.freeze([]),
      summary:
        'I did not find a financial lever to pull. Ask me about arrears, KRA, utilities, or cashflow.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP Finance needed ${route.lineWorker} for intent "${intent.text}" but it is not registered for this scope.`,
        suggestedRiskTier: route.lineWorker === 'kra.filing-assistant' ? 'external-comm' : 'mutate',
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
    vpName: 'vp.finance',
    intentKind: intent.kind,
    rationale: `Routing to ${spawns.length} finance line-worker(s); ${gaps.length} capability gap(s) recorded.`,
    spawns: Object.freeze(spawns),
    gaps: Object.freeze(gaps),
  });
}
