import { describe, it, expect } from 'vitest';
import {
  buildMarketingSystemPrompt,
  MARKETING_METADATA,
  MARKETING_PROMPT_LAYER,
} from '../marketing-persona.js';
import { qualifyLead } from '../lead-qualifier.js';
import {
  generateDemoEstate,
  createDemoStore,
  putDemoEstate,
  getDemoEstate,
  isDemoTenantId,
  DEMO_TENANT_PREFIX,
} from '../demo-data-generator.js';
import { adviseTier, TIERS } from '../pricing-advisor.js';
import { buildWaitlistSignup } from '../waitlist-integrator.js';

describe('marketing-persona', () => {
  it('injects Mr. Mwikila identity into the system prompt', () => {
    const prompt = buildMarketingSystemPrompt({});
    expect(prompt).toContain('Mr. Mwikila');
    expect(prompt).toContain(MARKETING_PROMPT_LAYER);
  });

  it('notes visitor country when provided', () => {
    expect(buildMarketingSystemPrompt({ visitorCountry: 'KE' })).toContain('KE');
  });

  it('skips role discovery when role is detected', () => {
    expect(buildMarketingSystemPrompt({ visitorRole: 'owner' })).toContain('owner');
  });

  it('metadata is stable', () => {
    expect(MARKETING_METADATA.id).toBe('mr-mwikila-marketing');
  });
});

describe('lead-qualifier', () => {
  it('classifies an owner prospect', () => {
    const r = qualifyLead('I own a block of 12 units in Nairobi and rent is due monthly');
    expect(r.role).toBe('owner');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('classifies a tenant prospect', () => {
    const r = qualifyLead('I am a tenant who needs a receipt; rent is due next week');
    expect(r.role).toBe('tenant');
  });

  it('classifies a property manager', () => {
    const r = qualifyLead('I am a property manager handling 5 clients with owner reports due monthly');
    expect(r.role).toBe('manager');
  });

  it('classifies a station master', () => {
    const r = qualifyLead('I am a caretaker at the gate and need to log incidents');
    expect(r.role).toBe('station_master');
  });

  it('returns unknown for unrelated text', () => {
    const r = qualifyLead('what is the weather today');
    expect(r.role).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('infers portfolio size from unit count', () => {
    expect(qualifyLead('I have 80 units').portfolioSizeHint).toBe('mid');
    expect(qualifyLead('I have 5 units').portfolioSizeHint).toBe('micro');
  });

  it('routes to pricing when asked', () => {
    expect(qualifyLead('how much does it cost').route).toBe('pricing_advisor');
  });

  it('routes to sandbox on demo intent', () => {
    expect(qualifyLead('can I try a demo').route).toBe('sandbox_demo');
  });

  it('routes to waitlist when not ready', () => {
    expect(qualifyLead('not ready yet, maybe later').route).toBe('waitlist_signup');
  });
});

describe('demo-data-generator', () => {
  it('generates a deterministic demo estate', () => {
    const a = generateDemoEstate({
      sessionId: 'sess_123',
      tenantLabel: 'Goba',
      country: 'TZ',
      portfolioSize: 'small',
    });
    const b = generateDemoEstate({
      sessionId: 'sess_123',
      tenantLabel: 'Goba',
      country: 'TZ',
      portfolioSize: 'small',
    });
    expect(a.units.length).toBe(b.units.length);
    expect(a.units[0].id).toBe(b.units[0].id);
  });

  it('isolates demo tenant from production tenants', () => {
    const e = generateDemoEstate({
      sessionId: 'sess_abc',
      tenantLabel: 'Westlands',
      country: 'KE',
      portfolioSize: 'micro',
    });
    expect(e.tenantId.startsWith(DEMO_TENANT_PREFIX)).toBe(true);
    expect(isDemoTenantId(e.tenantId)).toBe(true);
    expect(isDemoTenantId('prod_tenant_1')).toBe(false);
  });

  it('does not leak data across session ids', () => {
    const a = generateDemoEstate({
      sessionId: 'A',
      tenantLabel: 'x',
      country: 'KE',
      portfolioSize: 'micro',
    });
    const b = generateDemoEstate({
      sessionId: 'B',
      tenantLabel: 'x',
      country: 'KE',
      portfolioSize: 'micro',
    });
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(a.units[0].id).not.toBe(b.units[0].id);
  });

  it('expires session after ttl', () => {
    const store = createDemoStore({ ttlMs: 1000 });
    const e = generateDemoEstate(
      { sessionId: 'exp', tenantLabel: 't', country: 'UG', portfolioSize: 'micro' },
      new Date('2026-01-01T00:00:00Z')
    );
    putDemoEstate(store, e);
    const later = new Date('2026-01-01T01:00:00Z');
    expect(getDemoEstate(store, 'exp', later)).toBeNull();
  });

  it('scales unit count with portfolio size', () => {
    const micro = generateDemoEstate({
      sessionId: 's',
      tenantLabel: 'x',
      country: 'KE',
      portfolioSize: 'micro',
    });
    const large = generateDemoEstate({
      sessionId: 's2',
      tenantLabel: 'x',
      country: 'KE',
      portfolioSize: 'large',
    });
    expect(large.units.length).toBeGreaterThan(micro.units.length);
  });
});

describe('pricing-advisor', () => {
  it('recommends starter for a micro portfolio', () => {
    const a = adviseTier({ unitCount: 5, role: 'owner' });
    expect(a.recommendedTier).toBe('starter');
  });

  it('recommends growth for 30 units', () => {
    expect(adviseTier({ unitCount: 30 }).recommendedTier).toBe('growth');
  });

  it('recommends estate for 150 units', () => {
    expect(adviseTier({ unitCount: 150 }).recommendedTier).toBe('estate');
  });

  it('recommends enterprise above the estate ceiling', () => {
    expect(adviseTier({ unitCount: 500 }).recommendedTier).toBe('enterprise');
  });

  it('tiers are ordered', () => {
    const prices = TIERS.slice(0, 3).map((t) => t.priceMonthlyUsd);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe('waitlist-integrator', () => {
  it('builds a valid signup payload for email', () => {
    const p = buildWaitlistSignup({
      sessionId: 's1',
      contactName: 'Jane',
      contactMethod: 'email',
      contactValue: 'jane@example.com',
      country: 'KE',
      role: 'owner',
    });
    expect(p.source).toBe('marketing_chat');
    expect(p.contact.value).toBe('jane@example.com');
  });

  it('rejects invalid email', () => {
    expect(() =>
      buildWaitlistSignup({
        sessionId: 's1',
        contactName: 'Jane',
        contactMethod: 'email',
        contactValue: 'nope',
      })
    ).toThrow();
  });

  it('accepts a phone contact', () => {
    const p = buildWaitlistSignup({
      sessionId: 's1',
      contactName: 'Juma',
      contactMethod: 'whatsapp',
      contactValue: '+255712345678',
    });
    expect(p.contact.method).toBe('whatsapp');
  });
});
