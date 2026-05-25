/**
 * VP Operations — orchestration. Pattern-matches owner intent against
 * the four ops line-workers and emits a SubMdSpawn plan.
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildLineWorkerSpawn,
  type OwnerIntent,
  type VpCapabilityGap,
  type VpLineWorkerCatalogue,
  type VpOrchestrationPlan,
} from '../shared/vp-base.js';

export const VP_OPERATIONS_LINE_WORKERS = Object.freeze([
  'maintenance.dispatch',
  'complaint.triage',
  'tenant.onboarding-officer',
  'inspections.scheduler',
] as const);

interface OpsRoute {
  readonly lineWorker: (typeof VP_OPERATIONS_LINE_WORKERS)[number];
  readonly initialInput: Readonly<Record<string, unknown>>;
  readonly description: string;
}

/**
 * Heuristic router from owner free-text → line-worker. Real
 * production wires an LLM router; the deterministic fallback below is
 * sufficient for tests and the bootstrap path.
 */
export function routeOpsIntent(intent: OwnerIntent): ReadonlyArray<OpsRoute> {
  const t = intent.text.toLowerCase();
  const routes: OpsRoute[] = [];

  if (/maintenance|repair|leak|broken|electrical|plumb/.test(t)) {
    routes.push({
      lineWorker: 'maintenance.dispatch',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Dispatch maintenance triage for the reported issue',
    });
  }
  if (/complaint|noise|dispute|nuisance|angry|unhappy/.test(t)) {
    routes.push({
      lineWorker: 'complaint.triage',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Classify and route the incoming complaint',
    });
  }
  if (/onboard|new tenant|move-?in|move in|welcome pack/.test(t)) {
    routes.push({
      lineWorker: 'tenant.onboarding-officer',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Run the tenant onboarding checklist',
    });
  }
  if (/inspect|walk-?through|condition report|annual check/.test(t)) {
    routes.push({
      lineWorker: 'inspections.scheduler',
      initialInput: { ownerIntent: intent.text, correlationId: intent.correlationId },
      description: 'Schedule and notify the inspection',
    });
  }

  // For status-checks and weekly reports, fan out to every line-worker
  // so the VP can aggregate.
  if (
    (intent.kind === 'status-check' || intent.kind === 'weekly-report-request') &&
    routes.length === 0
  ) {
    for (const lw of VP_OPERATIONS_LINE_WORKERS) {
      routes.push({
        lineWorker: lw,
        initialInput: { mode: 'status', correlationId: intent.correlationId },
        description: `Status pull from ${lw}`,
      });
    }
  }

  return Object.freeze(routes);
}

export async function orchestrateOps(args: {
  readonly intent: OwnerIntent;
  readonly catalogue: VpLineWorkerCatalogue;
}): Promise<VpOrchestrationPlan> {
  const { intent, catalogue } = args;
  const routes = routeOpsIntent(intent);

  if (routes.length === 0) {
    return Object.freeze({
      vpName: 'vp.operations',
      intentKind: intent.kind,
      rationale: 'No operational signal in the message; nothing to dispatch.',
      spawns: Object.freeze([]),
      gaps: Object.freeze([]),
      summary:
        'I read your note but did not find an operational action to take. Tell me which ticket, complaint, onboarding, or inspection you want me to push on.',
    });
  }

  const spawns = [];
  const gaps: VpCapabilityGap[] = [];

  for (const route of routes) {
    if (!catalogue.has({ name: route.lineWorker, scope: intent.scope })) {
      gaps.push({
        missingLineWorker: route.lineWorker,
        reason: `VP Operations needed ${route.lineWorker} for intent "${intent.text}" but it is not registered for this scope.`,
        suggestedRiskTier: 'mutate',
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
    vpName: 'vp.operations',
    intentKind: intent.kind,
    rationale: `Routing to ${spawns.length} line-worker(s); ${gaps.length} capability gap(s) recorded.`,
    spawns: Object.freeze(spawns),
    gaps: Object.freeze(gaps),
  });
}

/** Re-exported for type-narrowing in tests. */
export type OpsLineWorker = (typeof VP_OPERATIONS_LINE_WORKERS)[number];

// Ensure ScopeContext is referenced so the import is not dead-code
// pruned during typecheck on stricter compilers.
export type OpsScope = ScopeContext;
