/**
 * Agent-as-a-Service (AaaS) primitives.
 *
 * Three pricing models reflecting 2026 market practice:
 *   - per_call         (Anthropic / OpenAI API style — micropayment per request)
 *   - per_outcome      (Salesforce Agentforce — $2/conversation; pay only for closed deals)
 *   - per_subscription (OpenAI Operator / GPT Enterprise — fixed monthly + overages)
 */

import type {
  AaaSCallMetric,
  AaaSEndpoint,
  AaaSJobQuote,
  AaaSPricing,
  AaaSScope,
  AaaSSla,
  MeteringSink,
} from '../types.js';

export interface AaaSEndpointStore {
  put(endpoint: AaaSEndpoint): Promise<void>;
  get(endpointId: string): Promise<AaaSEndpoint | null>;
  list(): Promise<ReadonlyArray<AaaSEndpoint>>;
  listByAgent(agentId: string): Promise<ReadonlyArray<AaaSEndpoint>>;
  setStatus(args: {
    endpointId: string;
    status: AaaSEndpoint['status'];
  }): Promise<void>;
}

export class InMemoryAaaSEndpointStore implements AaaSEndpointStore {
  readonly #endpoints = new Map<string, AaaSEndpoint>();

  async put(endpoint: AaaSEndpoint): Promise<void> {
    this.#endpoints.set(endpoint.endpointId, endpoint);
  }

  async get(endpointId: string): Promise<AaaSEndpoint | null> {
    return this.#endpoints.get(endpointId) ?? null;
  }

  async list(): Promise<ReadonlyArray<AaaSEndpoint>> {
    return Array.from(this.#endpoints.values());
  }

  async listByAgent(
    agentId: string,
  ): Promise<ReadonlyArray<AaaSEndpoint>> {
    return Array.from(this.#endpoints.values()).filter(
      (e) => e.agentId === agentId,
    );
  }

  async setStatus(args: {
    endpointId: string;
    status: AaaSEndpoint['status'];
  }): Promise<void> {
    const existing = this.#endpoints.get(args.endpointId);
    if (existing) {
      this.#endpoints.set(args.endpointId, {
        ...existing,
        status: args.status,
      });
    }
  }
}

export interface PublishAgentEndpointArgs {
  readonly agentId: string;
  readonly domainId: string;
  readonly pricing: AaaSPricing;
  readonly sla: AaaSSla;
  readonly scope: AaaSScope;
}

export async function publishAgentEndpoint(args: {
  readonly store: AaaSEndpointStore;
  readonly input: PublishAgentEndpointArgs;
  readonly endpointId?: string;
  readonly now?: () => Date;
}): Promise<AaaSEndpoint> {
  const now = (args.now ?? (() => new Date()))();
  const endpointId =
    args.endpointId ?? `aaas-${args.input.agentId}-${args.input.domainId}-${now.getTime()}`;
  validatePricing(args.input.pricing);
  validateSla(args.input.sla);

  const endpoint: AaaSEndpoint = {
    endpointId,
    agentId: args.input.agentId,
    domainId: args.input.domainId,
    pricing: args.input.pricing,
    sla: args.input.sla,
    scope: args.input.scope,
    publishedAt: now.toISOString(),
    status: 'live',
  };
  await args.store.put(endpoint);
  return endpoint;
}

function validatePricing(p: AaaSPricing): void {
  if (p.unitPriceUsdCents < 0) {
    throw new Error('AaaS pricing: unitPriceUsdCents must be ≥ 0');
  }
  if (p.model === 'per_subscription') {
    if (p.monthlyUsdCents === undefined || p.monthlyUsdCents < 0) {
      throw new Error(
        'AaaS pricing: per_subscription requires monthlyUsdCents ≥ 0',
      );
    }
  }
}

function validateSla(s: AaaSSla): void {
  if (s.availabilityPct < 0 || s.availabilityPct > 100) {
    throw new Error('AaaS SLA: availabilityPct must be 0..100');
  }
  if (s.latencyP95Ms < 0) {
    throw new Error('AaaS SLA: latencyP95Ms must be ≥ 0');
  }
}

// =========================================================================
// Metering
// =========================================================================

export interface MeterAgentCallArgs {
  readonly endpointId: string;
  readonly callId: string;
  readonly tenantId: string;
  readonly units: number;
  readonly outcome: 'success' | 'failure' | 'partial';
}

export async function meterAgentCall(args: {
  readonly endpoint: AaaSEndpoint;
  readonly input: MeterAgentCallArgs;
  readonly sink?: MeteringSink;
  readonly now?: () => Date;
}): Promise<AaaSCallMetric> {
  const now = (args.now ?? (() => new Date()))();
  const cost = computeCallCost({
    pricing: args.endpoint.pricing,
    units: args.input.units,
    outcome: args.input.outcome,
  });

  const metric: AaaSCallMetric = {
    metricId: `mtr-${args.input.callId}`,
    endpointId: args.input.endpointId,
    callId: args.input.callId,
    tenantId: args.input.tenantId,
    units: args.input.units,
    outcome: args.input.outcome,
    costUsdCents: cost,
    capturedAt: now.toISOString(),
  };
  if (args.sink) {
    await args.sink.emit(metric);
  }
  return metric;
}

/**
 * Cost rules:
 *   - per_call      : units × unitPriceUsdCents, regardless of outcome
 *   - per_outcome   : units × unitPriceUsdCents only when outcome === 'success'
 *                     (partial → 50%, failure → 0)
 *   - per_subscription: caller settles at month-end; per-call cost is 0
 *                       (the invoice rollup computes the monthly + overage)
 */
export function computeCallCost(args: {
  readonly pricing: AaaSPricing;
  readonly units: number;
  readonly outcome: 'success' | 'failure' | 'partial';
}): number {
  switch (args.pricing.model) {
    case 'per_call':
      return Math.round(args.units * args.pricing.unitPriceUsdCents);
    case 'per_outcome':
      if (args.outcome === 'success') {
        return Math.round(args.units * args.pricing.unitPriceUsdCents);
      }
      if (args.outcome === 'partial') {
        return Math.round(args.units * args.pricing.unitPriceUsdCents * 0.5);
      }
      return 0;
    case 'per_subscription':
      return 0;
  }
}

// =========================================================================
// Quotes
// =========================================================================

export interface PriceQuoteForJobArgs {
  readonly endpointId: string;
  readonly job: {
    readonly estimatedUnits: number;
    readonly confidence: number; // 0..1
  };
  readonly ttlSeconds?: number;
}

export async function priceQuoteForJob(args: {
  readonly endpoint: AaaSEndpoint;
  readonly input: PriceQuoteForJobArgs;
  readonly now?: () => Date;
}): Promise<AaaSJobQuote> {
  const now = (args.now ?? (() => new Date()))();
  const ttlSeconds = args.input.ttlSeconds ?? 3600; // 1h default
  const estimatedCost = computeCallCost({
    pricing: args.endpoint.pricing,
    units: args.input.job.estimatedUnits,
    outcome: 'success',
  });
  return {
    endpointId: args.input.endpointId,
    estimatedCostUsdCents: estimatedCost,
    sla: args.endpoint.sla,
    confidence: clamp01(args.input.job.confidence),
    assumedUnits: args.input.job.estimatedUnits,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
