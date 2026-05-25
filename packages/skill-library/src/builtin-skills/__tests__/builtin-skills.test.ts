import { describe, expect, it } from 'vitest';
import { StubEntityStore } from '../../voyager-library/index.js';
import type { SkillExecutionContext } from '../../voyager-library/index.js';
import {
  handleLateRentSkill,
  computeStep,
  compileWeeklyReportSkill,
  dispatchMaintenanceSkill,
  rankVendorCandidates,
  scoreVendor,
  slaForSeverity,
  onboardTenantSkill,
  nextStep,
  chaseArrearsSkill,
  chooseAction,
  prepareKraFilingSkill,
  JurisdictionMismatchError,
  BUILTIN_SKILLS,
} from '../index.js';

function ctx(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    entity_store: new StubEntityStore(),
    tenant_id: 'tenant-1',
    jurisdiction: 'KE',
    correlation_id: 'corr-1',
    now: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('handle-late-rent', () => {
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

  it('writes a late_rent_event entity to the store', async () => {
    const store = new StubEntityStore();
    const res = await handleLateRentSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      lease_id: 'lease-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    expect(res.step).toBe('first_notice');
    expect(res.attribute_written).toBe(true);
    expect(res.idempotent_skip).toBe(false);
    const attrs = store._attributesFor('tenant-1', 'lease-9::first_notice::2026-05-19');
    expect(attrs.length).toBe(3);
  });

  it('is idempotent on re-run with same provenance hash (same day)', async () => {
    const store = new StubEntityStore();
    await handleLateRentSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      lease_id: 'lease-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    const second = await handleLateRentSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 'tenant-1',
      lease_id: 'lease-9',
      days_late: 12,
      preferred_channel: 'sms',
    });
    expect(second.idempotent_skip).toBe(true);
    expect(second.attribute_written).toBe(false);
  });
});

describe('compile-weekly-report', () => {
  it('aggregates rent collected by currency', async () => {
    const store = new StubEntityStore();
    const res = await compileWeeklyReportSkill.code.run(ctx({ entity_store: store }), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      property_ids: ['p1', 'p2'],
      signals: {
        rent_payments: [
          { amount: 100_000, currency: 'KES', property_id: 'p1', payment_date: '2026-05-13' },
          { amount: 50_000, currency: 'KES', property_id: 'p1', payment_date: '2026-05-14' },
          { amount: 200_000, currency: 'TZS', property_id: 'p2', payment_date: '2026-05-15' },
        ],
        unit_snapshot: [
          { unit_id: 'u1', property_id: 'p1', status: 'occupied' },
          { unit_id: 'u2', property_id: 'p1', status: 'vacant' },
        ],
        maintenance_closures: [],
        arrears: [],
      },
    });
    expect(res.rent_collected_by_currency['KES']).toBe(150_000);
    expect(res.rent_collected_by_currency['TZS']).toBe(200_000);
    expect(res.occupancy_ratio).toBe(0.5);
    expect(res.maintenance_closed_count).toBe(0);
    expect(res.attribute_written).toBe(true);
  });

  it('buckets arrears by days_late and currency', async () => {
    const store = new StubEntityStore();
    const res = await compileWeeklyReportSkill.code.run(ctx({ entity_store: store }), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      property_ids: ['p1'],
      signals: {
        rent_payments: [],
        unit_snapshot: [],
        maintenance_closures: [],
        arrears: [
          { tenant_id: 't1', days_late: 15, amount: 10_000, currency: 'KES' },
          { tenant_id: 't2', days_late: 45, amount: 20_000, currency: 'KES' },
          { tenant_id: 't3', days_late: 95, amount: 30_000, currency: 'TZS' },
        ],
      },
    });
    expect(res.arrears_by_bucket.d_0_30.count).toBe(1);
    expect(res.arrears_by_bucket.d_31_60.count).toBe(1);
    expect(res.arrears_by_bucket.d_90p.count).toBe(1);
    expect(res.arrears_by_bucket.d_90p.total_by_currency['TZS']).toBe(30_000);
  });

  it('returns occupancy_ratio === 0 for empty snapshot', async () => {
    const res = await compileWeeklyReportSkill.code.run(ctx(), {
      window_start: '2026-05-12',
      window_end: '2026-05-19',
      property_ids: [],
      signals: {
        rent_payments: [],
        unit_snapshot: [],
        maintenance_closures: [],
        arrears: [],
      },
    });
    expect(res.occupancy_ratio).toBe(0);
  });
});

describe('dispatch-maintenance', () => {
  it('scoreVendor: locality + category + rating + load', () => {
    const score = scoreVendor(
      { vendor_id: 'v1', categories: ['plumbing'], locality: 'kilimani', rating: 5, open_tickets: 0 },
      'plumbing',
      'kilimani'
    );
    expect(score).toBeCloseTo(0.4 + 0.3 + 0.2 + 0.1, 5);
  });

  it('rankVendorCandidates sorts descending by score', () => {
    const ranked = rankVendorCandidates(
      [
        { vendor_id: 'v_far', categories: ['plumbing'], locality: 'westlands', rating: 5, open_tickets: 0 },
        { vendor_id: 'v_local', categories: ['plumbing'], locality: 'kilimani', rating: 4, open_tickets: 1 },
      ],
      'plumbing',
      'kilimani'
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
        category: 'plumbing',
        locality: 'kilimani',
        severity: 2,
        description: 'leak',
        candidates: [],
      })
    ).rejects.toThrow(/No candidate vendors/);
  });

  it('writes a dispatch entity with the winning vendor', async () => {
    const store = new StubEntityStore();
    const r = await dispatchMaintenanceSkill.code.run(ctx({ entity_store: store }), {
      ticket_id: 'tic-1',
      category: 'electrical',
      locality: 'westlands',
      severity: 3,
      description: 'no power in 4B',
      candidates: [
        { vendor_id: 'va', categories: ['plumbing'], locality: 'kilimani', rating: 5, open_tickets: 0 },
        { vendor_id: 'vb', categories: ['electrical'], locality: 'westlands', rating: 4.5, open_tickets: 1 },
      ],
    });
    expect(r.assigned_vendor_id).toBe('vb');
    expect(r.attribute_written).toBe(true);
    expect(r.sla_respond_hours).toBe(24);
  });
});

describe('onboard-tenant', () => {
  it('nextStep walks the ladder', () => {
    expect(nextStep('kyc_started')).toBe('lease_drafted');
    expect(nextStep('lease_drafted')).toBe('deposit_recorded');
    expect(nextStep('deposit_recorded')).toBe('unit_allocated');
    expect(nextStep('unit_allocated')).toBe('welcome_pack_sent');
    expect(nextStep('welcome_pack_sent')).toBeNull();
  });

  it('writes a step entity and surfaces next_step', async () => {
    const store = new StubEntityStore();
    const r = await onboardTenantSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 't1',
      step: 'kyc_started',
      payload: { full_name: 'Jane Doe', national_id: 'A1' },
    });
    expect(r.attribute_written).toBe(true);
    expect(r.next_step).toBe('lease_drafted');
  });

  it('is idempotent: re-running same step does not double-write', async () => {
    const store = new StubEntityStore();
    await onboardTenantSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 't1',
      step: 'kyc_started',
      payload: {},
    });
    const r2 = await onboardTenantSkill.code.run(ctx({ entity_store: store }), {
      tenant_id: 't1',
      step: 'kyc_started',
      payload: {},
    });
    expect(r2.idempotent_skip).toBe(true);
  });
});

describe('chase-arrears', () => {
  it('chooseAction: legal review past 90 days regardless of history', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 100, on_time_ratio: 1 })
    ).toBe('legal_review_requested');
  });

  it('chooseAction: 61-90 days escalates regardless of history', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 70, on_time_ratio: 1 })
    ).toBe('escalate_to_operator');
  });

  it('chooseAction: 31-60 days offers a plan', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 45, on_time_ratio: 0.9 })
    ).toBe('payment_plan_offer');
  });

  it('chooseAction: 1-30 with good history is reminder only', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 10, on_time_ratio: 0.95 })
    ).toBe('reminder_only');
  });

  it('chooseAction: 1-30 with spotty history offers plan', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 10, on_time_ratio: 0.7 })
    ).toBe('payment_plan_offer');
  });

  it('chooseAction: 1-30 with bad history escalates', () => {
    expect(
      chooseAction({ tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 10, on_time_ratio: 0.2 })
    ).toBe('escalate_to_operator');
  });

  it('runs batch + aggregates counts', async () => {
    const r = await chaseArrearsSkill.code.run(ctx(), {
      rows: [
        { tenant_id: 't1', amount: 10_000, currency: 'KES', days_late: 5, on_time_ratio: 0.95 },
        { tenant_id: 't2', amount: 20_000, currency: 'TZS', days_late: 45, on_time_ratio: 0.5 },
        { tenant_id: 't3', amount: 30_000, currency: 'KES', days_late: 95, on_time_ratio: 0.9 },
      ],
    });
    expect(r.actions).toHaveLength(3);
    expect(r.action_counts.reminder_only).toBe(1);
    expect(r.action_counts.payment_plan_offer).toBe(1);
    expect(r.action_counts.legal_review_requested).toBe(1);
  });
});

describe('prepare-kra-filing — KE-only', () => {
  it('throws when jurisdiction is not KE', async () => {
    await expect(
      prepareKraFilingSkill.code.run(ctx({ jurisdiction: 'TZ' }), {
        period_yyyy_mm: '2026-04',
        payments: [],
        mri_rate: 0.075,
      })
    ).rejects.toThrow(JurisdictionMismatchError);
  });

  it('rejects malformed period strings', async () => {
    await expect(
      prepareKraFilingSkill.code.run(ctx(), {
        period_yyyy_mm: 'apr-26',
        payments: [],
        mri_rate: 0.075,
      })
    ).rejects.toThrow(/yyyy-mm/);
  });

  it('aggregates gross income for KES payments only', async () => {
    const r = await prepareKraFilingSkill.code.run(ctx(), {
      period_yyyy_mm: '2026-04',
      payments: [
        { property_id: 'p1', amount: 100_000, currency: 'KES', payment_date: '2026-04-05' },
        { property_id: 'p2', amount: 200_000, currency: 'KES', payment_date: '2026-04-15' },
      ],
      mri_rate: 0.075,
    });
    expect(r.gross_rental_income).toBe(300_000);
    expect(r.tax_due).toBeCloseTo(22_500, 5);
  });

  it('reports currency violations without folding them into gross', async () => {
    const r = await prepareKraFilingSkill.code.run(ctx(), {
      period_yyyy_mm: '2026-04',
      payments: [
        { property_id: 'p1', amount: 100_000, currency: 'KES', payment_date: '2026-04-05' },
        { property_id: 'p2', amount: 80_000, currency: 'TZS', payment_date: '2026-04-15' },
      ],
      mri_rate: 0.075,
    });
    expect(r.gross_rental_income).toBe(100_000);
    expect(r.currency_violations).toHaveLength(1);
    expect(r.currency_violations[0]?.currency).toBe('TZS');
  });

  it('writes a kra_filing_draft entity', async () => {
    const store = new StubEntityStore();
    const r = await prepareKraFilingSkill.code.run(ctx({ entity_store: store }), {
      period_yyyy_mm: '2026-04',
      payments: [
        { property_id: 'p1', amount: 100_000, currency: 'KES', payment_date: '2026-04-05' },
      ],
      mri_rate: 0.075,
    });
    expect(r.attribute_written).toBe(true);
    expect(r.draft_entity_id).toBe('kra_filing::tenant-1::2026-04');
  });
});

describe('BUILTIN_SKILLS bundle', () => {
  it('exports exactly the 6 expected skill ids', () => {
    expect(BUILTIN_SKILLS.map((s) => s.id).sort()).toEqual(
      [
        'chase-arrears',
        'compile-weekly-report',
        'dispatch-maintenance',
        'handle-late-rent',
        'onboard-tenant',
        'prepare-kra-filing',
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
