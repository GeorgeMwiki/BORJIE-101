/**
 * Audit-chain + budgets tests.
 */

import { describe, it, expect } from 'vitest';
import { buildMarketingAuditLink } from '../audit/audit-chain-link.js';
import { CostTracker, COST_CEILINGS_USD } from '../budgets/cost-tracker.js';
import { attributeLastTouch } from '../telemetry/attribution.js';
import { buildTelemetryEvent } from '../telemetry/conversion-tracker.js';
import type { SpanCitation } from '../types.js';
import { MarketingError } from '../types.js';

describe('audit-chain link', () => {
  it('produces a sealed hash and embeds citation ids', () => {
    const citations: ReadonlyArray<SpanCitation> = [
      { id: 'c1', claim: 'x', source: { kind: 'corpus_chunk', ref: 'r1' } },
    ];
    const link = buildMarketingAuditLink({
      tenant_id: 't1',
      recipe_id: 'r',
      recipe_version: 1,
      audience_segment: 'mineral_buyer',
      authority_tier: 1,
      channel: 'linkedin_organic',
      variant_id: 'v0',
      checksum: 'abc',
      span_citations: citations,
      generated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(link.audit_hash).toMatch(/^[a-f0-9]+$/);
    expect((link.payload['span_citation_ids'] as ReadonlyArray<string>).length).toBe(1);
  });
});

describe('cost tracker', () => {
  it('reserves and releases', () => {
    const t = new CostTracker();
    const r = t.reserve('social_post_single');
    expect(r.reserved_usd).toBe(COST_CEILINGS_USD.social_post_single);
    expect(t.outstanding()).toHaveLength(1);
    t.release(r);
    expect(t.outstanding()).toHaveLength(0);
  });

  it('refuses commit over ceiling', () => {
    const t = new CostTracker();
    expect(() =>
      t.commit({ asset_class: 'social_post_single', actual_usd: 1.0 }),
    ).toThrow(MarketingError);
  });

  it('commit under ceiling succeeds', () => {
    const t = new CostTracker();
    expect(() =>
      t.commit({ asset_class: 'social_post_single', actual_usd: 0.1 }),
    ).not.toThrow();
  });
});

describe('attribution', () => {
  it('attributes a conversion to the most-recent click', () => {
    const events = [
      buildTelemetryEvent({
        asset_id: 'A',
        tenant_id: 't',
        event_kind: 'click',
        channel: 'linkedin_organic',
        payload: { visitor_id: 'v1' },
        recorded_at: '2026-01-01T00:00:00.000Z',
      }),
      buildTelemetryEvent({
        asset_id: 'A',
        tenant_id: 't',
        event_kind: 'conversion',
        channel: 'linkedin_organic',
        payload: { visitor_id: 'v1' },
        recorded_at: '2026-01-02T00:00:00.000Z',
      }),
    ];
    const r = attributeLastTouch({ events });
    expect(r.total_conversions).toBe(1);
    expect(r.attributed_conversions['A']).toBe(1);
  });

  it('drops conversions outside the 7-day window', () => {
    const events = [
      buildTelemetryEvent({
        asset_id: 'A',
        tenant_id: 't',
        event_kind: 'click',
        channel: 'linkedin_organic',
        payload: { visitor_id: 'v1' },
        recorded_at: '2026-01-01T00:00:00.000Z',
      }),
      buildTelemetryEvent({
        asset_id: 'A',
        tenant_id: 't',
        event_kind: 'conversion',
        channel: 'linkedin_organic',
        payload: { visitor_id: 'v1' },
        recorded_at: '2026-02-01T00:00:00.000Z',
      }),
    ];
    const r = attributeLastTouch({ events });
    expect(r.total_conversions).toBe(1);
    expect(r.attributed_conversions['A']).toBeUndefined();
  });
});
