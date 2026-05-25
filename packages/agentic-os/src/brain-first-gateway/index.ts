/**
 * brain-first-gateway — every inbound request flows through the brain
 * FIRST. The brain reads the envelope, classifies the intent, looks up
 * agents capable of the inferred capability, and picks the best one by
 * composite score (trust × capability fit × cost × latency × autonomy
 * headroom).
 *
 * If the brain is unavailable (timeout / error), the gateway falls back
 * to a deterministic intent → capability map so the request is never
 * stranded. Tenant scope is always enforced.
 */

import type {
  AgentMatch,
  AgentRegistryPort,
  BrainPort,
  CapabilityRegistryPort,
  IntentClassification,
  Jurisdiction,
  OpenClawPort,
  RegisteredCapability,
  RequestEnvelope,
  RoutingDecision,
  TrustStorePort,
} from '../types.js';
import { autonomyToInt, nowIso, TenantScopeError } from '../types.js';

/** Static fallback map: intent prefix → capability id. */
export interface FallbackRoute {
  readonly intentPrefix: string;
  readonly capabilityId: string;
  readonly riskClass: 'low' | 'med' | 'high' | 'critical';
}

export interface RouteRequestArgs {
  readonly envelope: RequestEnvelope;
  readonly brain: BrainPort | null;
  readonly agentRegistry: AgentRegistryPort;
  readonly capabilities: CapabilityRegistryPort;
  readonly trustStore: TrustStorePort;
  readonly openClaw?: OpenClawPort;
  readonly fallbackRoutes?: ReadonlyArray<FallbackRoute>;
  /** Brain call timeout in ms — past this we fall back. Default 800. */
  readonly brainTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 800;

const NO_AGENT_RATIONALE = 'no capable agent found within tenant scope';

const DETERMINISTIC_FALLBACK_INTENT: IntentClassification = Object.freeze({
  primary: 'unclassified.fallback',
  secondary: [] as ReadonlyArray<string>,
  confidence: 0.1,
  rationale: 'brain unavailable; deterministic fallback used',
  suggestedDomain: 'general',
  riskClass: 'low',
  entities: {} as Readonly<Record<string, unknown>>,
});

/**
 * Brain-first route resolution. Returns a routing decision the caller
 * uses to dispatch the request.
 */
export async function routeRequest(
  args: RouteRequestArgs,
): Promise<RoutingDecision> {
  if (!args.envelope.tenantId || args.envelope.tenantId.trim() === '') {
    throw new TenantScopeError('request envelope missing tenantId');
  }

  const intent = await safeClassify(
    args.envelope,
    args.brain,
    args.brainTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    args.fallbackRoutes ?? [],
  );

  const capabilityId = await pickCapabilityIdFromIntent({
    intent,
    capabilities: args.capabilities,
    fallbackRoutes: args.fallbackRoutes ?? [],
  });

  if (capabilityId === null) {
    return Object.freeze<RoutingDecision>({
      requestId: args.envelope.requestId,
      intent,
      chosenAgent: null,
      fallbackUsed: intent === DETERMINISTIC_FALLBACK_INTENT,
      rationale: 'no capability matched intent',
      routedAt: nowIso(),
    });
  }

  // Resolve autonomy ceiling
  const autonomyCeiling = args.openClaw
    ? await args.openClaw.capForJurisdiction({
        jurisdiction: args.envelope.jurisdiction,
        riskClass: intent.riskClass,
      })
    : 'L3';

  const candidates = await args.capabilities.findCapable({
    capabilityId,
    tenantId: args.envelope.tenantId,
    jurisdiction: args.envelope.jurisdiction,
    autonomyLevel: autonomyCeiling,
  });

  const matches = await rankCandidates({
    candidates,
    intent,
    jurisdiction: args.envelope.jurisdiction,
    autonomyCeiling,
    agentRegistry: args.agentRegistry,
    trustStore: args.trustStore,
  });

  const chosen = matches.length > 0 ? matches[0] ?? null : null;

  return Object.freeze<RoutingDecision>({
    requestId: args.envelope.requestId,
    intent,
    chosenAgent: chosen,
    fallbackUsed: intent === DETERMINISTIC_FALLBACK_INTENT,
    rationale: chosen
      ? `routed to agent ${chosen.agentId} (score=${chosen.score.toFixed(3)})`
      : NO_AGENT_RATIONALE,
    routedAt: nowIso(),
  });
}

async function safeClassify(
  envelope: RequestEnvelope,
  brain: BrainPort | null,
  timeoutMs: number,
  fallbackRoutes: ReadonlyArray<FallbackRoute>,
): Promise<IntentClassification> {
  if (!brain) {
    return deterministicIntent(envelope, fallbackRoutes);
  }
  try {
    const result = await withTimeout(
      brain.classifyIntent({ envelope }),
      timeoutMs,
    );
    return result;
  } catch {
    return deterministicIntent(envelope, fallbackRoutes);
  }
}

function deterministicIntent(
  envelope: RequestEnvelope,
  fallbackRoutes: ReadonlyArray<FallbackRoute>,
): IntentClassification {
  const utterance = envelope.utterance.toLowerCase();
  for (const route of fallbackRoutes) {
    if (utterance.includes(route.intentPrefix)) {
      return Object.freeze({
        primary: route.intentPrefix,
        secondary: [] as ReadonlyArray<string>,
        confidence: 0.5,
        rationale: 'deterministic fallback matched intent prefix',
        suggestedDomain: route.intentPrefix.split('.')[0] ?? 'general',
        riskClass: route.riskClass,
        entities: {} as Readonly<Record<string, unknown>>,
      });
    }
  }
  return DETERMINISTIC_FALLBACK_INTENT;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('brain timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

interface PickCapabilityArgs {
  readonly intent: IntentClassification;
  readonly capabilities: CapabilityRegistryPort;
  readonly fallbackRoutes: ReadonlyArray<FallbackRoute>;
}

async function pickCapabilityIdFromIntent(
  args: PickCapabilityArgs,
): Promise<string | null> {
  // Try exact match on intent.primary first
  const exact = await args.capabilities.findByCapabilityId(args.intent.primary);
  if (exact.length > 0) return args.intent.primary;

  // Try domain match
  const byDomain = await args.capabilities.findByDomain(
    args.intent.suggestedDomain,
  );
  if (byDomain.length > 0 && byDomain[0]) return byDomain[0].capability.id;

  // Try fallback routes
  for (const route of args.fallbackRoutes) {
    if (args.intent.primary.startsWith(route.intentPrefix)) {
      return route.capabilityId;
    }
  }
  return null;
}

interface RankArgs {
  readonly candidates: ReadonlyArray<RegisteredCapability>;
  readonly intent: IntentClassification;
  readonly jurisdiction: Jurisdiction;
  readonly autonomyCeiling: string;
  readonly agentRegistry: AgentRegistryPort;
  readonly trustStore: TrustStorePort;
}

async function rankCandidates(args: RankArgs): Promise<ReadonlyArray<AgentMatch>> {
  const matches: AgentMatch[] = [];
  for (const candidate of args.candidates) {
    const trust = await args.trustStore.getScore({
      agentId: candidate.agentId,
      capabilityId: candidate.capability.id,
    });
    const trustScore = trust?.meanSuccessRate ?? 0.5;

    const capabilityFit = computeCapabilityFit(candidate, args.intent);
    const costPenalty = computeCostPenalty(candidate);
    const latencyPenalty = computeLatencyPenalty(candidate);

    // Autonomy headroom — how comfortable agent is at the ceiling
    const ceilingInt = autonomyToInt(args.autonomyCeiling as never);
    const recommendedInt = trust ? autonomyToInt(trust.recommendedCeiling) : 2;
    const autonomyHeadroom = recommendedInt >= ceilingInt ? 1.0 : Math.max(0, recommendedInt / Math.max(1, ceilingInt));

    const score =
      trustScore * 0.4 +
      capabilityFit * 0.3 +
      (1 - costPenalty) * 0.1 +
      (1 - latencyPenalty) * 0.1 +
      autonomyHeadroom * 0.1;

    matches.push(
      Object.freeze<AgentMatch>({
        agentId: candidate.agentId,
        capabilityId: candidate.capability.id,
        score,
        breakdown: Object.freeze({
          trustScore,
          capabilityFit,
          costPenalty,
          latencyPenalty,
          autonomyHeadroom,
        }),
      }),
    );
  }
  return Object.freeze(matches.slice().sort((a, b) => b.score - a.score));
}

function computeCapabilityFit(
  candidate: RegisteredCapability,
  intent: IntentClassification,
): number {
  // Exact match
  if (candidate.capability.id === intent.primary) return 1.0;
  // Same domain prefix
  const candDomain = candidate.capability.id.split('.')[0] ?? '';
  if (candDomain === intent.suggestedDomain) return 0.7;
  // Same risk class
  if (candidate.capability.sideEffects === intent.riskClass) return 0.4;
  return 0.2;
}

function computeCostPenalty(candidate: RegisteredCapability): number {
  // Normalise: cost 0..2000 cents → 0..1
  return Math.min(1, candidate.capability.costEstimateUsdCents / 2000);
}

function computeLatencyPenalty(candidate: RegisteredCapability): number {
  // Normalise: latency 0..30s → 0..1
  return Math.min(1, candidate.capability.latencyEstimateMs / 30_000);
}
