import { describe, expect, it } from 'vitest';
import { StubEntityStore } from '../../voyager-library/index.js';
import type { SkillExecutionContext } from '../../voyager-library/index.js';
import {
  handleLateRoyaltySkill,
  computeStep,
  compileWeeklyReportSkill,
  dispatchMaintenanceSkill,
  rankVendorCandidates,
  scoreVendor,
  slaForSeverity,
  onboardCounterpartySkill,
  nextStep,
  chaseOutstandingRoyaltiesSkill,
  chooseAction,
  prepareTraFilingSkill,
  JurisdictionMismatchError,
  BUILTIN_SKILLS,
} from '../index.js';

function ctx(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    entity_store: new StubEntityStore(),
    tenant_id: 'tenant-1',
    jurisdiction: 'TZ',
    correlation_id: 'corr-1',
    now: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('handle-late-royalty', () => {
  it('computeStep: grace window for short delays', () => {
    expect(computeStep(0)).toBe('grace_window');
    expect(computeStep(5)).toBe('grace_window');
  });

  it('computeStep: first notice after grace', () => {
    expect(computeStep(6)).toBe('first_notice');
    expect(computeStep(15)).toBe('first_notice');
  });

  it('computeStep: second notice after 15 days past grace', () => {
    expect(computeStep(20)).toBe('second_notice');
  });

  it('computeStep: escalation past 35 days late', () => {
    expect(computeStep(40)).toBe('escalation');
    expect(computeStep(100)).toBe('escalation');
  });

  it('writes a late_royalty_event entity to the store', async () => {
    const store = new StubEntityStore();
    const res = await handleLateRoyaltySkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      agreement_id: 'agreement-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    expect(res.step).toBe('first_notice');
    expect(res.attribute_written).toBe(true);
    expect(res.idempotent_skip).toBe(false);
    const attrs = store._attributesFor('tenant-1', 'agreement-9::first_notice::2026-05-19');
    expect(attrs.length).toBe(3);
  });

  it('is idempotent on re-run with same provenance hash (same day)', async () => {
    const store = new StubEntityStore();
    await handleLateRoyaltySkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      agreement_id: 'agreement-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    const second = await handleLateRoyaltySkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      agreement_id: 'agreement-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    expect(second.idempotent_skip).toBe(true);
    expect(second.attribute_written).toBe(false);
  });
});

describe('compile-weekly-report', () => {
  it('aggregates royalty collected by currency', async () => {
    const store = new StubEntityStore();
    const res = await compileWeeklyReportSkill.code.run(ctx({ entity_store: store }), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      site_ids: ['s1', 's2'],
      signals: {
        royalty_payments: [
          { amount: 100_000, currency: 'TZS', site_id: 's1', payment_date: '2026-05-13' },
          { amount: 50_000, currency: 'TZS', site_id: 's1', payment_date: '2026-05-14' },
          { amount: 200_000, currency: 'KES', site_id: 's2', payment_date: '2026-05-15' },
        ],
        asset_snapshot: [
          { asset_id: 'a1', site_id: 's1', status: 'producing' },
          { asset_id: 'a2', site_id: 's1', status: 'idle' },
        ],
        maintenance_closures: [],
        outstanding_royalties: [],
      },
    });
    expect(res.royalty_collected_by_currency['TZS']).toBe(150_000);
    expect(res.royalty_collected_by_currency['KES']).toBe(200_000);
    expect(res.production_utilisation_ratio).toBe(0.5);
    expect(res.maintenance_closed_count).toBe(0);
    expect(res.attribute_written).toBe(true);
  });

  it('buckets outstanding royalties by days_late and currency', async () => {
    const store = new StubEntityStore();
    const res = await compileWeeklyReportSkill.code.run(ctx({ entity_store: store }), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      site_ids: ['s1'],
      signals: {
        royalty_payments: [],
        asset_snapshot: [],
        maintenance_closures: [],
        outstanding_royalties: [
          { counterparty_id: 'c1', days_late: 15, amount: 10_000, currency: 'TZS' },
          { counterparty_id: 'c2', days_late: 45, amount: 20_000, currency: 'TZS' },
          { counterparty_id: 'c3', days_late: 95, amount: 30_000, currency: 'KES' },
        ],
      },
    });
    expect(res.outstanding_royalties_by_bucket.d_0_30.count).toBe(1);
    expect(res.outstanding_royalties_by_bucket.d_31_60.count).toBe(1);
    expect(res.outstanding_royalties_by_bucket.d_90p.count).toBe(1);
    expect(res.outstanding_royalties_by_bucket.d_90p.total_by_currency['KES']).toBe(30_000);
  });

  it('returns production_utilisation_ratio === 0 for empty snapshot', async () => {
    const res = await compileWeeklyReportSkill.code.run(ctx(), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      site_ids: [],
      signals: {
        royalty_payments: [],
        asset_snapshot: [],
        maintenance_closures: [],
        outstanding_royalties: [],
      },
    });
    expect(res.production_utilisation_ratio).toBe(0);
  });
});

describe('dispatch-maintenance', () => {
  it('scoreVendor: locality + category + rating + load', () => {
    const score = scoreVendor(
      { vendor_id: 'v1', categories: ['fitting'], locality: 'geita', rating: 5, open_tickets: 0 },
      'fitting',
      'geita'
    );
    expect(score).toBeCloseTo(0.4 + 0.3 + 0.2 + 0.1, 5);
  });

  it('rankVendorCandidates sorts descending by score', () => {
    const ranked = rankVendorCandidates(
      [
        { vendor_id: 'v_far', categories: ['fitting'], locality: 'mwanza', rating: 5, open_tickets: 0 },
        { vendor_id: 'v_local', categories: ['fitting'], locality: 'geita', rating: 4, open_tickets: 1 },
      ],
      'fitting',
      'geita'
    );
    expect(ranked[0]?.vendor_id).toBe('v_local');
  });

  it('slaForSeverity tightens with severity', () => {
    const s1 = slaForSeverity(1);
    const s4 = slaForSeverity(4);
    expect(s1.respond_hours).toBeLessThan(s4.respond_hours);
    expect(s1.resolve_hours).toBeLessThan(s4.resolve_hours);
  });

  it('throws when no candidates', async () => {
    await expect(
      dispatchMaintenanceSkill.code.run(ctx(), {
        ticket_id: 't1',
        category: 'fitting',
        locality: 'geita',
        severity: 2,
        description: 'pump seal failure',
        candidates: [],
      })
    ).rejects.toThrow(/No candidate vendors/);
  });

  it('writes a dispatch entity with the winning vendor', async () => {
    const store = new StubEntityStore();
    const r = await dispatchMaintenanceSkill.code.run(ctx({ entity_store: store }), {
      ticket_id: 'tic-1',
      category: 'electrical',
      locality: 'mwanza',
      severity: 3,
      description: 'crusher motor down at plant 4',
      candidates: [
        { vendor_id: 'va', categories: ['fitting'], locality: 'geita', rating: 5, open_tickets: 0 },
        { vendor_id: 'vb', categories: ['electrical'], locality: 'mwanza', rating: 4.5, open_tickets: 1 },
      ],
    });
    expect(r.assigned_vendor_id).toBe('vb');
    expect(r.attribute_written).toBe(true);
    expect(r.sla_respond_hours).toBe(24);
  });
});

describe('onboard-counterparty', () => {
  it('nextStep walks the ladder', () => {
    expect(nextStep('kyc_started')).toBe('agreement_drafted');
    expect(nextStep('agreement_drafted')).toBe('prepayment_recorded');
    expect(nextStep('prepayment_recorded')).toBe('allocation_confirmed');
    expect(nextStep('allocation_confirmed')).toBe('welcome_pack_sent');
    expect(nextStep('welcome_pack_sent')).toBeNull();
  });

  it('writes a step entity and surfaces next_step', async () => {
    const store = new StubEntityStore();
    const r = await onboardCounterpartySkill.code.run(ctx({ entity_store: store }), {
      counterparty_id: 'c1',
      step: 'kyc_started',
      payload: { full_name: 'Jane Doe', national_id: 'A1' },
    });
    expect(r.attribute_written).toBe(true);
    expect(r.next_step).toBe('agreement_drafted');
  });

  it('is idempotent: re-running same step does not double-write', async () => {
    const store = new StubEntityStore();
    await onboardCounterpartySkill.code.run(ctx({ entity_store: store }), {
      counterparty_id: 'c1',
      step: 'kyc_started',
      payload: {},
    });
    const r2 = await onboardCounterpartySkill.code.run(ctx({ entity_store: store }), {
      counterparty_id: 'c1',
      step: 'kyc_started',
      payload: {},
    });
    expect(r2.idempotent_skip).toBe(true);
  });
});

describe('chase-outstanding-royalties', () => {
  it('chooseAction: legal review past 90 days regardless of history', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 100, on_time_ratio: 1 })
    ).toBe('legal_review_requested');
  });

  it('chooseAction: 61-90 days escalates regardless of history', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 70, on_time_ratio: 1 })
    ).toBe('escalate_to_operator');
  });

  it('chooseAction: 31-60 days offers a plan', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 45, on_time_ratio: 0.9 })
    ).toBe('payment_plan_offer');
  });

  it('chooseAction: 1-30 with good history is reminder only', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 10, on_time_ratio: 0.95 })
    ).toBe('reminder_only');
  });

  it('chooseAction: 1-30 with spotty history offers plan', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 10, on_time_ratio: 0.7 })
    ).toBe('payment_plan_offer');
  });

  it('chooseAction: 1-30 with bad history escalates', () => {
    expect(
      chooseAction({ counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 10, on_time_ratio: 0.2 })
    ).toBe('escalate_to_operator');
  });

  it('runs batch + aggregates counts', async () => {
    const r = await chaseOutstandingRoyaltiesSkill.code.run(ctx(), {
      rows: [
        { counterparty_id: 'c1', amount: 10_000, currency: 'TZS', days_late: 5, on_time_ratio: 0.95 },
        { counterparty_id: 'c2', amount: 20_000, currency: 'KES', days_late: 45, on_time_ratio: 0.5 },
        { counterparty_id: 'c3', amount: 30_000, currency: 'TZS', days_late: 95, on_time_ratio: 0.9 },
      ],
    });
    expect(r.actions).toHaveLength(3);
    expect(r.action_counts.reminder_only).toBe(1);
    expect(r.action_counts.payment_plan_offer).toBe(1);
    expect(r.action_counts.legal_review_requested).toBe(1);
  });
});

describe('prepare-tra-filing — TZ-only', () => {
  it('throws when jurisdiction is not TZ', async () => {
    await expect(
      prepareTraFilingSkill.code.run(ctx({ jurisdiction: 'KE' }), {
        period_yyyy_mm: '2026-04',
        payments: [],
        royalty_rate: 0.06,
      })
    ).rejects.toThrow(JurisdictionMismatchError);
  });

  it('rejects malformed period strings', async () => {
    await expect(
      prepareTraFilingSkill.code.run(ctx(), {
        period_yyyy_mm: 'apr-26',
        payments: [],
        royalty_rate: 0.06,
      })
    ).rejects.toThrow(/yyyy-mm/);
  });

  it('aggregates gross mineral value for TZS payments only', async () => {
    const r = await prepareTraFilingSkill.code.run(ctx(), {
      period_yyyy_mm: '2026-04',
      payments: [
        { site_id: 's1', amount: 100_000, currency: 'TZS', payment_date: '2026-04-05' },
        { site_id: 's2', amount: 200_000, currency: 'TZS', payment_date: '2026-04-15' },
      ],
      royalty_rate: 0.06,
    });
    expect(r.gross_mineral_value).toBe(300_000);
    expect(r.royalty_due).toBeCloseTo(18_000, 5);
  });

  it('reports currency violations without folding them into gross', async () => {
    const r = await prepareTraFilingSkill.code.run(ctx(), {
      period_yyyy_mm: '2026-04',
      payments: [
        { site_id: 's1', amount: 100_000, currency: 'TZS', payment_date: '2026-04-05' },
        { site_id: 's2', amount: 80_000, currency: 'KES', payment_date: '2026-04-15' },
      ],
      royalty_rate: 0.06,
    });
    expect(r.gross_mineral_value).toBe(100_000);
    expect(r.currency_violations).toHaveLength(1);
    expect(r.currency_violations[0]?.currency).toBe('KES');
  });

  it('writes a tra_filing_draft entity', async () => {
    const store = new StubEntityStore();
    const r = await prepareTraFilingSkill.code.run(ctx({ entity_store: store }), {
      period_yyyy_mm: '2026-04',
      payments: [
        { site_id: 's1', amount: 100_000, currency: 'TZS', payment_date: '2026-04-05' },
      ],
      royalty_rate: 0.06,
    });
    expect(r.attribute_written).toBe(true);
    expect(r.draft_entity_id).toBe('tra_filing::tenant-1::2026-04');
  });
});

describe('BUILTIN_SKILLS bundle', () => {
  it('exports exactly the 6 expected skill ids', () => {
    expect(BUILTIN_SKILLS.map((s) => s.id).sort()).toEqual(
      [
        'chase-outstanding-royalties',
        'compile-weekly-report',
        'dispatch-maintenance',
        'handle-late-royalty',
        'onboard-counterparty',
        'prepare-tra-filing',
      ].sort()
    );
  });

  it('every skill has a non-empty embedding', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.embedding.length).toBeGreaterThan(0);
    }
  });

  it('every skill starts with zero usage counters', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.success_count).toBe(0);
      expect(s.failure_count).toBe(0);
      expect(s.consecutive_failures).toBe(0);
      expect(s.quarantined).toBe(false);
    }
  });
});
