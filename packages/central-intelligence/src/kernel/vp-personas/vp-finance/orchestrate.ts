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
  'royalty.chaser',
  'tra.filing-assistant',
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

  if (/outstanding royalties|royalt|overdue|late payment|chase|outstanding/.test(t)) {
    routes.push({
      lineWorker: 'royalty.chaser',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Run the outstanding-royalties ladder for overdue accounts',
    });
  }
  if (/tra|kra|tax|mri|withholding|filing/.test(t)) {
    routes.push({
      lineWorker: 'tra.filing-assistant',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Prepare the TRA royalty filing — owner signs off before submission',
    });
  }
  if (/utility|water|electric|tanesco|fuel|diesel|levy|service charge/.test(t)) {
    routes.push({
      lineWorker: 'utility-billing-clerk',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Reconcile utility / fuel bills and post counterparty allocations',
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
        'I did not find a financial lever to pull. Ask me about outstanding royalties, TRA, utilities, or cashflow.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP Finance needed ${route.lineWorker} for intent "${intent.text}" but it is not registered for this scope.`,
        suggestedRiskTier: route.lineWorker === 'tra.filing-assistant' ? 'external-comm' : 'mutate',
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
