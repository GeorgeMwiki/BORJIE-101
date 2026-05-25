import { describe, expect, it } from 'vitest';
import { createVendorOnboardingSubMd, VENDOR_ONBOARDING_NAME } from '../index.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  type ObservedEvent,
  type SubMdContext,
  type SubMdLlmPort,
} from '../../shared/sub-md-base.js';

const TENANT = 't1';

const llm: SubMdLlmPort = {
  async generate() {
    return {
      text: JSON.stringify({
        summary: 'Auto-retry KYC after 24h on transient errors',
        steps: [
          { id: 'kyc-retry', description: 'Retry KYC after 24h when error=adapter-timeout', expectedImpact: '+8% first-attempt pass' },
        ],
        predicted: { metric: 'time-to-active-hours', value: 60, unit: 'hours' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-vendor',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

describe('vendor.onboarding — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE', async () => {
    const sub = createVendorOnboardingSubMd({ scope: { tenantId: TENANT } });
    const events: ObservedEvent[] = [
      { id: '1', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 1, payload: { vendorId: 'v1', state: 'kyc-requested' } },
      { id: '2', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 2, payload: { vendorId: 'v1', state: 'kyc-verified' } },
      { id: '3', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 3, payload: { vendorId: 'v1', state: 'capabilities-classified' } },
      { id: '4', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 4, payload: { vendorId: 'v1', state: 'msa-drafted' } },
      { id: '5', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 5, payload: { vendorId: 'v1', state: 'msa-signed' } },
      { id: '6', topic: 'vendor.onboarding', tenantId: TENANT, occurredAtMs: 6, payload: { vendorId: 'v1', state: 'active' } },
    ];
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(6);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('vendor-onboarding.')).toBe(true);
  });

  it('exposes 4 tools', () => {
    const sub = createVendorOnboardingSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('vendor.setup_payment_rail');
  });

  it('riskTier is mutate (reversible payment-rail add)', () => {
    const sub = createVendorOnboardingSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('mutate');
  });

  it('name matches', () => {
    const sub = createVendorOnboardingSubMd({ scope: { tenantId: TENANT } });
    expect(sub.name).toBe(VENDOR_ONBOARDING_NAME);
  });
});
