/**
 * R16 — Negotiation LLM counter-offer generator tests (G-FIX-2).
 *
 * Covers:
 *   1. Happy path: LLM returns valid JSON counter inside the
 *      [lowerBound, listPrice] band, rationale flows through, model
 *      tier is tagged with the LLM model id.
 *   2. Cache marker: system block carries cache_control: ephemeral.
 *   3. Fallback on LLM throw: heuristic kicks in, modelTier stays
 *      'stub' (i.e. the wrapper does NOT overwrite the heuristic).
 *   4. Fallback on missing rationale: heuristic kicks in, warn logged.
 *   5. Fallback on no client (null): heuristic is returned directly.
 *   6. Clamping: LLM returns a slightly out-of-band offer; wrapper
 *      clamps it to [lowerBound, listPrice].
 */

import { describe, expect, it, vi } from 'vitest';
import type { TenantId, ISOTimestamp } from '@borjie/domain-models';

import { createLlmCounterGenerator } from '../llm-counter-generator.js';
import type {
  NegotiationLlmClient,
  NegotiationLlmRequest,
  NegotiationLlmResponse,
} from '../llm-counter-generator.js';
import type {
  AiCounterGenerator,
  AiCounterRequest,
  AiCounterResult,
} from '../negotiation-service.js';
import {
  asNegotiationId,
  asNegotiationPolicyId,
  type Negotiation,
  type NegotiationPolicy,
} from '../types.js';

const TENANT = 'tnt_test' as TenantId;

function samplePolicy(): NegotiationPolicy {
  return {
    id: asNegotiationPolicyId('pol_1'),
    tenantId: TENANT,
    unitId: null,
    propertyId: null,
    domain: 'lease_price',
    listPrice: 1_000_000,
    floorPrice: 800_000,
    approvalRequiredBelow: 850_000,
    maxDiscountPct: 0.2,
    currency: 'TZS',
    acceptableConcessions: [],
    toneGuide: 'firm',
    autoSendCounters: true,
    expiresAt: null,
    active: true,
    createdAt: '2026-05-29T00:00:00Z' as ISOTimestamp,
    createdBy: null,
    updatedAt: '2026-05-29T00:00:00Z' as ISOTimestamp,
    updatedBy: null,
  };
}

function sampleNegotiation(): Negotiation {
  return {
    id: asNegotiationId('neg_1'),
    tenantId: TENANT,
    unitId: null,
    propertyId: null,
    prospectCustomerId: 'cust_1',
    counterpartyId: null,
    listingId: null,
    tenderId: null,
    bidId: null,
    policyId: asNegotiationPolicyId('pol_1'),
    domain: 'lease_price',
    status: 'open',
    aiPersona: 'PRICE_NEGOTIATOR',
    currentOffer: 750_000,
    currentOfferBy: 'prospect',
    roundCount: 1,
    agreedPrice: null,
    closedAt: null,
    closureReason: null,
    escalatedAt: null,
    escalatedTo: null,
    createdAt: '2026-05-29T00:00:00Z' as ISOTimestamp,
    lastActivityAt: '2026-05-29T00:00:00Z' as ISOTimestamp,
    expiresAt: null,
  };
}

function sampleRequest(overrides: Partial<AiCounterRequest> = {}): AiCounterRequest {
  return {
    policy: samplePolicy(),
    negotiation: sampleNegotiation(),
    history: [],
    lowerBound: 850_000,
    ...overrides,
  };
}

const HEURISTIC: AiCounterGenerator = async () => ({
  offer: 900_000,
  concessions: [],
  rationale: '[STUB] Deterministic midpoint',
  modelTier: 'stub',
});

function makeStubClient(
  responses: Array<Partial<NegotiationLlmResponse>>,
): NegotiationLlmClient & {
  readonly capturedRequests: NegotiationLlmRequest[];
} {
  const capturedRequests: NegotiationLlmRequest[] = [];
  let i = 0;
  return {
    model: 'claude-haiku-test',
    capturedRequests,
    messages: {
      async create(req: NegotiationLlmRequest) {
        capturedRequests.push(req);
        const r = responses[i] ?? responses[responses.length - 1] ?? {};
        i += 1;
        return {
          content: r.content ?? [],
          usage: r.usage ?? { input_tokens: 1, output_tokens: 1 },
        } as NegotiationLlmResponse;
      },
    },
  } as NegotiationLlmClient & {
    readonly capturedRequests: NegotiationLlmRequest[];
  };
}

describe('createLlmCounterGenerator', () => {
  it('returns the LLM counter on the happy path with cache marker', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              offer: 920_000,
              rationale: 'EN: tight market. SW: soko ni kali.',
              concessions: [],
            }),
          },
        ],
      },
    ]);
    const gen = createLlmCounterGenerator({
      client,
      heuristic: HEURISTIC,
    });
    const out = await gen(sampleRequest());
    expect(out.offer).toBe(920_000);
    expect(out.rationale).toContain('SW:');
    expect(out.modelTier).toBe('claude-haiku-test');
    const sys = client.capturedRequests[0]!.system as ReadonlyArray<{
      readonly cache_control?: { readonly type: string };
    }>;
    expect(sys[0]?.cache_control?.type).toBe('ephemeral');
  });

  it('clamps LLM offers to [lowerBound, listPrice]', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              offer: 1_500_000,
              rationale: 'EN: high. SW: juu.',
            }),
          },
        ],
      },
    ]);
    const gen = createLlmCounterGenerator({ client, heuristic: HEURISTIC });
    const out = await gen(sampleRequest());
    expect(out.offer).toBeLessThanOrEqual(1_000_000);
    expect(out.offer).toBeGreaterThanOrEqual(850_000);
  });

  it('falls back to heuristic when LLM throws', async () => {
    const failing: NegotiationLlmClient = {
      model: 'fail-model',
      messages: {
        async create() {
          throw new Error('500 Internal');
        },
      },
    };
    const warn = vi.fn();
    const gen = createLlmCounterGenerator({
      client: failing,
      heuristic: HEURISTIC,
      logger: { warn },
    });
    const out = await gen(sampleRequest());
    expect(out.modelTier).toBe('stub');
    expect(out.offer).toBe(900_000);
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to heuristic when LLM omits rationale', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ offer: 900_000, rationale: '' }),
          },
        ],
      },
    ]);
    const warn = vi.fn();
    const gen = createLlmCounterGenerator({
      client,
      heuristic: HEURISTIC,
      logger: { warn },
    });
    const out = await gen(sampleRequest());
    expect(out.modelTier).toBe('stub');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'negotiation-counter-r16' }),
      expect.stringContaining('missing rationale'),
    );
  });

  it('short-circuits to heuristic when client is null (no API key)', async () => {
    const gen = createLlmCounterGenerator({
      client: null,
      heuristic: HEURISTIC,
    });
    const out = await gen(sampleRequest());
    expect(out.modelTier).toBe('stub');
  });

  it('honors a modelOverride when supplied', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              offer: 880_000,
              rationale: 'EN: ok. SW: sawa.',
            }),
          },
        ],
      },
    ]);
    const gen = createLlmCounterGenerator({
      client,
      heuristic: HEURISTIC,
      modelOverride: 'claude-sonnet-4-6',
    });
    const out = await gen(sampleRequest());
    expect(out.modelTier).toBe('claude-sonnet-4-6');
  });
});
