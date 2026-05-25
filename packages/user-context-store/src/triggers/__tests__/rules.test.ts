/**
 * Trigger rule fixtures.
 *
 * Each test covers either:
 *   - "rule fires" — given a profile + signals fixture, the rule should
 *     return a Trigger
 *   - "rule does NOT fire" — the same shape but tuned so the rule
 *     returns null
 *
 * We test through the `computeTriggers` engine so the role-filter is
 * also exercised, then assert presence/absence of the specific kind.
 */
import { describe, expect, it } from 'vitest';
import { computeTriggers } from '../engine.js';
import { ALL_TRIGGER_RULES, triggerKey } from '../rules.js';
import type {
  AnyProfile,
  BehavioralSignals,
  IntentSignal,
  OwnerProfile,
  PMProfile,
  ProspectProfile,
  Role,
  TenantProfile,
  AdminProfile,
} from '../../types.js';

const fixedNow = new Date('2026-05-24T12:00:00Z');

function emptySignals(intents: IntentSignal[] = []): BehavioralSignals {
  return {
    recentActivity: {
      windowDays: 14,
      loginCount: 0,
      pagesViewed: 0,
      featuresTouched: [],
      searchQueries: [],
    },
    openItems: {
      openMaintenanceCount: 0,
      unpaidInvoiceCount: 0,
      unpaidBalance: 0,
      expiringDocuments: [],
      leaseDecisionsDue: [],
      pendingSignOffs: [],
    },
    lifecycleStage: 'active',
    intentSignals: intents,
  };
}

function tenant(partial: Partial<TenantProfile> = {}): AnyProfile {
  return {
    identity: { userId: 'u1', tenantId: 't1' },
    ...partial,
  };
}
function owner(partial: Partial<OwnerProfile> = {}): AnyProfile {
  return {
    identity: { userId: 'u2', tenantId: 't1' },
    properties: [],
    ...partial,
  };
}
function pm(partial: Partial<PMProfile> = {}): AnyProfile {
  return {
    identity: { userId: 'u3', tenantId: 't1' },
    managedProperties: [],
    ...partial,
  };
}
function admin(partial: Partial<AdminProfile> = {}): AnyProfile {
  return {
    identity: { userId: 'u4', tenantId: 't1' },
    ...partial,
  };
}
function prospect(partial: Partial<ProspectProfile> = {}): AnyProfile {
  return {
    identity: { userId: 'u5', tenantId: 't1' },
    ...partial,
  };
}

function fire(role: Role, profile: AnyProfile, signals = emptySignals(), now = fixedNow): ReadonlyArray<string> {
  return computeTriggers({
    profile,
    signals,
    role,
    userId: profile.identity.userId,
    tenantId: profile.identity.tenantId,
    now,
  }).map((t) => t.kind);
}

describe('trigger-rule catalogue', () => {
  it('exposes 25+ rules', () => {
    expect(ALL_TRIGGER_RULES.length).toBeGreaterThanOrEqual(25);
  });

  it('produces deterministic triggerKey for same input', () => {
    expect(triggerKey('u', 'kind.a', fixedNow)).toBe(triggerKey('u', 'kind.a', fixedNow));
  });
});

// ----- Tenant rules

describe('tenant.lease_ending_90d', () => {
  it('fires when lease ends in ~75 days', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 75 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).toContain(
      'tenant.lease_ending_90d',
    );
  });
  it('does NOT fire when lease is 200 days out', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 200 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).not.toContain(
      'tenant.lease_ending_90d',
    );
  });
});

describe('tenant.lease_ending_60d', () => {
  it('fires when lease ends in ~45 days', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 45 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).toContain(
      'tenant.lease_ending_60d',
    );
  });
  it('does NOT fire at 80 days', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 80 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).not.toContain(
      'tenant.lease_ending_60d',
    );
  });
});

describe('tenant.lease_ending_30d', () => {
  it('fires when lease ends in 10 days', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 10 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).toContain(
      'tenant.lease_ending_30d',
    );
  });
  it('does NOT fire at 35 days', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      endDate: new Date(fixedNow.getTime() + 35 * 86400 * 1000).toISOString(),
    };
    expect(fire('tenant', tenant({ currentLease: lease }))).not.toContain(
      'tenant.lease_ending_30d',
    );
  });
});

describe('tenant.payment_late_7d', () => {
  it('fires when latest payment is 10 days late', () => {
    expect(
      fire('tenant', tenant({
        paymentHistory24m: [
          { month: '2026-05', totalCharged: 50000, totalPaid: 0, balance: 50000, daysLate: 10, currency: 'KES' },
        ],
      })),
    ).toContain('tenant.payment_late_7d');
  });
  it('does NOT fire when payment is current', () => {
    expect(
      fire('tenant', tenant({
        paymentHistory24m: [
          { month: '2026-05', totalCharged: 50000, totalPaid: 50000, balance: 0, daysLate: 0, currency: 'KES' },
        ],
      })),
    ).not.toContain('tenant.payment_late_7d');
  });
});

describe('tenant.payment_late_14d', () => {
  it('fires when latest payment is 20 days late', () => {
    expect(
      fire('tenant', tenant({
        paymentHistory24m: [
          { month: '2026-05', totalCharged: 50000, totalPaid: 0, balance: 50000, daysLate: 20, currency: 'KES' },
        ],
      })),
    ).toContain('tenant.payment_late_14d');
  });
  it('does NOT fire when latest is only 5 days late', () => {
    expect(
      fire('tenant', tenant({
        paymentHistory24m: [
          { month: '2026-05', totalCharged: 50000, totalPaid: 30000, balance: 20000, daysLate: 5, currency: 'KES' },
        ],
      })),
    ).not.toContain('tenant.payment_late_14d');
  });
});

describe('tenant.repeat_maintenance_same_category_90d', () => {
  it('fires when 3 maintenance items in same category within 90d', () => {
    const make = (i: number) => ({
      workOrderId: `wo-${i}`,
      workOrderNumber: `WO-${i}`,
      category: 'plumbing',
      priority: 'medium',
      status: 'completed',
      submittedAt: new Date(fixedNow.getTime() - i * 86400 * 1000).toISOString(),
    });
    expect(
      fire('tenant', tenant({
        closedMaintenance12m: [make(5), make(20), make(40)],
      })),
    ).toContain('tenant.repeat_maintenance_same_category_90d');
  });
  it('does NOT fire when only 1 item', () => {
    expect(
      fire('tenant', tenant({
        closedMaintenance12m: [{
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-1',
          category: 'plumbing',
          priority: 'low',
          status: 'completed',
          submittedAt: fixedNow.toISOString(),
        }],
      })),
    ).not.toContain('tenant.repeat_maintenance_same_category_90d');
  });
});

describe('tenant.energy_bill_up_yoy', () => {
  it('fires when EUI > 200', () => {
    expect(
      fire('tenant', tenant({
        property: {
          propertyId: 'p1',
          propertyCode: 'PROP-A',
          name: 'Prop A',
          euiKwhPerSqmYr: 280,
        },
      })),
    ).toContain('tenant.energy_bill_up_yoy');
  });
  it('does NOT fire when no EUI data', () => {
    expect(
      fire('tenant', tenant({
        property: {
          propertyId: 'p1',
          propertyCode: 'PROP-A',
          name: 'Prop A',
        },
      })),
    ).not.toContain('tenant.energy_bill_up_yoy');
  });
});

describe('tenant.unresolved_escalation_7d', () => {
  it('fires when high-priority work order is open >7d', () => {
    expect(
      fire('tenant', tenant({
        openMaintenance: [{
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-1',
          category: 'electrical',
          priority: 'high',
          status: 'in_progress',
          submittedAt: new Date(fixedNow.getTime() - 10 * 86400 * 1000).toISOString(),
        }],
      })),
    ).toContain('tenant.unresolved_escalation_7d');
  });
  it('does NOT fire when low priority', () => {
    expect(
      fire('tenant', tenant({
        openMaintenance: [{
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-1',
          category: 'electrical',
          priority: 'low',
          status: 'in_progress',
          submittedAt: new Date(fixedNow.getTime() - 30 * 86400 * 1000).toISOString(),
        }],
      })),
    ).not.toContain('tenant.unresolved_escalation_7d');
  });
});

describe('tenant.document_expiring_30d', () => {
  it('fires when openItems lists an expiring doc', () => {
    const sig = emptySignals();
    const docSig: BehavioralSignals = {
      ...sig,
      openItems: {
        ...sig.openItems,
        expiringDocuments: [{ kind: 'passport', expiresAt: fixedNow.toISOString() }],
      },
    };
    expect(fire('tenant', tenant(), docSig)).toContain('tenant.document_expiring_30d');
  });
  it('does NOT fire when no expiring docs', () => {
    expect(fire('tenant', tenant())).not.toContain('tenant.document_expiring_30d');
  });
});

describe('tenant.household_change_recorded', () => {
  it('fires when household total > 4', () => {
    expect(
      fire('tenant', tenant({
        currentLease: { leaseId: 'l1', leaseNumber: 'LSE-1', status: 'active' },
        household: { adults: 3, children: 3, pets: 0 },
      })),
    ).toContain('tenant.household_change_recorded');
  });
  it('does NOT fire for small household', () => {
    expect(
      fire('tenant', tenant({
        currentLease: { leaseId: 'l1', leaseNumber: 'LSE-1', status: 'active' },
        household: { adults: 2, children: 1, pets: 0 },
      })),
    ).not.toContain('tenant.household_change_recorded');
  });
});

describe('tenant.neighborhood_event_nearby', () => {
  it('fires when intent signal explicitly present', () => {
    const sig = emptySignals([
      { kind: 'neighborhood.event_nearby', confidence: 0.7, evidence: 'event x' },
    ]);
    expect(fire('tenant', tenant(), sig)).toContain('tenant.neighborhood_event_nearby');
  });
  it('does NOT fire without intent signal', () => {
    expect(fire('tenant', tenant())).not.toContain('tenant.neighborhood_event_nearby');
  });
});

// ----- Owner rules

describe('owner.unit_vacant_45d', () => {
  it('fires when any property has <95% occupancy', () => {
    expect(
      fire('owner', owner({ properties: [
        { propertyId: 'p1', propertyName: 'P1', currency: 'KES', occupancyPct: 80 },
      ] })),
    ).toContain('owner.unit_vacant_45d');
  });
  it('does NOT fire at 100% occupancy', () => {
    expect(
      fire('owner', owner({ properties: [
        { propertyId: 'p1', propertyName: 'P1', currency: 'KES', occupancyPct: 100 },
      ] })),
    ).not.toContain('owner.unit_vacant_45d');
  });
});

describe('owner.noi_down_10pct', () => {
  it('fires when intent signal noi_down present', () => {
    expect(
      fire('owner',
        owner({
          properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
          totalPortfolioNoi: 1000,
        }),
        emptySignals([
          { kind: 'finance.noi_down', confidence: 0.9, evidence: 'down 12%' },
        ]),
      ),
    ).toContain('owner.noi_down_10pct');
  });
  it('does NOT fire without intent signal', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
        totalPortfolioNoi: 1000,
      })),
    ).not.toContain('owner.noi_down_10pct');
  });
});

describe('owner.mortgage_payment_due', () => {
  it('fires when any property has mortgage outstanding', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES', mortgageOutstanding: 10000000 }],
      })),
    ).toContain('owner.mortgage_payment_due');
  });
  it('does NOT fire without mortgage', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
      })),
    ).not.toContain('owner.mortgage_payment_due');
  });
});

describe('owner.insurance_expiring_60d', () => {
  it('fires when insurance expires in 30d', () => {
    expect(
      fire('owner', owner({
        properties: [{
          propertyId: 'p1', propertyName: 'P1', currency: 'KES',
          insuranceExpiresAt: new Date(fixedNow.getTime() + 30 * 86400 * 1000).toISOString(),
        }],
      })),
    ).toContain('owner.insurance_expiring_60d');
  });
  it('does NOT fire when insurance expires in 1 year', () => {
    expect(
      fire('owner', owner({
        properties: [{
          propertyId: 'p1', propertyName: 'P1', currency: 'KES',
          insuranceExpiresAt: new Date(fixedNow.getTime() + 365 * 86400 * 1000).toISOString(),
        }],
      })),
    ).not.toContain('owner.insurance_expiring_60d');
  });
});

describe('owner.capex_line_flagged', () => {
  it('fires when any property has capex 12m total', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES', capex12mTotal: 500000 }],
      })),
    ).toContain('owner.capex_line_flagged');
  });
  it('does NOT fire without capex', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
      })),
    ).not.toContain('owner.capex_line_flagged');
  });
});

describe('owner.tax_filing_window', () => {
  it('fires when intent signal present', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
      }), emptySignals([
        { kind: 'tax.filing_window', confidence: 1, evidence: 'window opens June 1' },
      ])),
    ).toContain('owner.tax_filing_window');
  });
  it('does NOT fire without intent signal', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
      })),
    ).not.toContain('owner.tax_filing_window');
  });
});

describe('owner.occupancy_below_90pct', () => {
  it('fires when portfolio occupancy avg <90', () => {
    expect(
      fire('owner', owner({
        properties: [
          { propertyId: 'p1', propertyName: 'P1', currency: 'KES', occupancyPct: 85 },
          { propertyId: 'p2', propertyName: 'P2', currency: 'KES', occupancyPct: 80 },
        ],
      })),
    ).toContain('owner.occupancy_below_90pct');
  });
  it('does NOT fire when portfolio at 95%', () => {
    expect(
      fire('owner', owner({
        properties: [
          { propertyId: 'p1', propertyName: 'P1', currency: 'KES', occupancyPct: 95 },
        ],
      })),
    ).not.toContain('owner.occupancy_below_90pct');
  });
});

describe('owner.churn_spike', () => {
  it('fires when any property has churn >=15', () => {
    expect(
      fire('owner', owner({
        properties: [
          { propertyId: 'p1', propertyName: 'P1', currency: 'KES', tenantChurnPct: 18 },
        ],
      })),
    ).toContain('owner.churn_spike');
  });
  it('does NOT fire at low churn', () => {
    expect(
      fire('owner', owner({
        properties: [
          { propertyId: 'p1', propertyName: 'P1', currency: 'KES', tenantChurnPct: 5 },
        ],
      })),
    ).not.toContain('owner.churn_spike');
  });
});

describe('owner.refinancing_window_opens', () => {
  it('fires when refi window signal present', () => {
    expect(
      fire('owner',
        owner({ properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }] }),
        emptySignals([
          { kind: 'finance.refi_window', confidence: 0.85, evidence: 'rates dropped 75 bps' },
        ]),
      ),
    ).toContain('owner.refinancing_window_opens');
  });
  it('does NOT fire without signal', () => {
    expect(
      fire('owner', owner({
        properties: [{ propertyId: 'p1', propertyName: 'P1', currency: 'KES' }],
      })),
    ).not.toContain('owner.refinancing_window_opens');
  });
});

// ----- PM rules

describe('pm.sla_missed_last_week', () => {
  it('fires when slaBreachesLast30d >=1', () => {
    expect(
      fire('pm', pm({ kpis: { slaBreachesLast30d: 2 } })),
    ).toContain('pm.sla_missed_last_week');
  });
  it('does NOT fire at 0', () => {
    expect(
      fire('pm', pm({ kpis: { slaBreachesLast30d: 0 } })),
    ).not.toContain('pm.sla_missed_last_week');
  });
});

describe('pm.escalation_backlog_5plus', () => {
  it('fires at 5 escalations', () => {
    expect(
      fire('pm', pm({ kpis: { escalationsLast30d: 6 } })),
    ).toContain('pm.escalation_backlog_5plus');
  });
  it('does NOT fire below 5', () => {
    expect(
      fire('pm', pm({ kpis: { escalationsLast30d: 2 } })),
    ).not.toContain('pm.escalation_backlog_5plus');
  });
});

describe('pm.vendor_sla_breach', () => {
  it('fires when any vendor on probation', () => {
    expect(
      fire('pm', pm({ vendors: [{ vendorId: 'v1', companyName: 'Acme', status: 'probation' }] })),
    ).toContain('pm.vendor_sla_breach');
  });
  it('does NOT fire when all active', () => {
    expect(
      fire('pm', pm({ vendors: [{ vendorId: 'v1', companyName: 'Acme', status: 'active' }] })),
    ).not.toContain('pm.vendor_sla_breach');
  });
});

describe('pm.staff_workload_imbalance', () => {
  it('fires when intent signal present and team >=2', () => {
    expect(
      fire('pm',
        pm({ staffUnderMgmt: [
          { userId: 's1', name: 'A' }, { userId: 's2', name: 'B' },
        ] }),
        emptySignals([
          { kind: 'workload.imbalance', confidence: 0.7, evidence: 'p99 vs p50 differ' },
        ]),
      ),
    ).toContain('pm.staff_workload_imbalance');
  });
  it('does NOT fire without signal', () => {
    expect(
      fire('pm', pm({ staffUnderMgmt: [
        { userId: 's1', name: 'A' }, { userId: 's2', name: 'B' },
      ] })),
    ).not.toContain('pm.staff_workload_imbalance');
  });
});

describe('pm.kpi_target_miss', () => {
  it('fires when occupancy KPI <90', () => {
    expect(
      fire('pm', pm({ kpis: { occupancyPct: 85 } })),
    ).toContain('pm.kpi_target_miss');
  });
  it('does NOT fire when KPIs healthy', () => {
    expect(
      fire('pm', pm({ kpis: { occupancyPct: 95, avgResponseTimeMinutes: 30 } })),
    ).not.toContain('pm.kpi_target_miss');
  });
});

// ----- Admin rules

describe('admin.billing_tier_near_limit', () => {
  it('fires at 90 users on starter', () => {
    expect(
      fire('admin', admin({ totalUsers: 90, billingPosition: { tier: 'starter' } })),
    ).toContain('admin.billing_tier_near_limit');
  });
  it('does NOT fire on enterprise', () => {
    expect(
      fire('admin', admin({ totalUsers: 90, billingPosition: { tier: 'enterprise' } })),
    ).not.toContain('admin.billing_tier_near_limit');
  });
});

describe('admin.feature_usage_anomaly', () => {
  it('fires when any feature has 0 usage', () => {
    expect(
      fire('admin', admin({ featureUsage30d: { dashboards: 5, reports: 0 } })),
    ).toContain('admin.feature_usage_anomaly');
  });
  it('does NOT fire when usage healthy', () => {
    expect(
      fire('admin', admin({ featureUsage30d: { dashboards: 5, reports: 10 } })),
    ).not.toContain('admin.feature_usage_anomaly');
  });
});

describe('admin.high_severity_risk_flag', () => {
  it('fires when any high severity flag exists', () => {
    expect(
      fire('admin', admin({ riskFlags: [
        { kind: 'data_breach', severity: 'high', summary: 'test' },
      ] })),
    ).toContain('admin.high_severity_risk_flag');
  });
  it('does NOT fire when only low severity', () => {
    expect(
      fire('admin', admin({ riskFlags: [
        { kind: 'minor', severity: 'low', summary: 'test' },
      ] })),
    ).not.toContain('admin.high_severity_risk_flag');
  });
});

// ----- Prospect rules

describe('prospect.viewing_pattern_ready_to_tour', () => {
  it('fires at 4 viewings', () => {
    expect(
      fire('prospect', prospect({
        propertiesViewed: [
          { propertyId: 'p1', viewedAt: '2026-05-01' },
          { propertyId: 'p2', viewedAt: '2026-05-02' },
          { propertyId: 'p3', viewedAt: '2026-05-03' },
          { propertyId: 'p4', viewedAt: '2026-05-04' },
        ],
      })),
    ).toContain('prospect.viewing_pattern_ready_to_tour');
  });
  it('does NOT fire at 1 viewing', () => {
    expect(
      fire('prospect', prospect({
        propertiesViewed: [{ propertyId: 'p1', viewedAt: '2026-05-01' }],
      })),
    ).not.toContain('prospect.viewing_pattern_ready_to_tour');
  });
});

describe('prospect.saved_listing_aging', () => {
  it('fires when saved listing >14d old', () => {
    expect(
      fire('prospect', prospect({
        savedListings: [
          { propertyId: 'p1', savedAt: new Date(fixedNow.getTime() - 20 * 86400 * 1000).toISOString() },
        ],
      })),
    ).toContain('prospect.saved_listing_aging');
  });
  it('does NOT fire when fresh save', () => {
    expect(
      fire('prospect', prospect({
        savedListings: [
          { propertyId: 'p1', savedAt: new Date(fixedNow.getTime() - 2 * 86400 * 1000).toISOString() },
        ],
      })),
    ).not.toContain('prospect.saved_listing_aging');
  });
});

// ----- Engine behavior

describe('computeTriggers', () => {
  it('sorts results by urgency desc', () => {
    const lease30 = {
      leaseId: 'l1', leaseNumber: 'LSE-1', status: 'active',
      endDate: new Date(fixedNow.getTime() + 10 * 86400 * 1000).toISOString(),
    };
    const triggers = computeTriggers({
      profile: tenant({ currentLease: lease30 }),
      signals: emptySignals(),
      role: 'tenant',
      userId: 'u1',
      tenantId: 't1',
      now: fixedNow,
    });
    for (let i = 1; i < triggers.length; i++) {
      expect(triggers[i - 1]!.urgency).toBeGreaterThanOrEqual(triggers[i]!.urgency);
    }
  });

  it('filters out triggers not applicable to role', () => {
    const triggers = computeTriggers({
      profile: tenant({
        currentLease: {
          leaseId: 'l1', leaseNumber: 'LSE-1', status: 'active',
          endDate: new Date(fixedNow.getTime() + 75 * 86400 * 1000).toISOString(),
        },
      }),
      signals: emptySignals(),
      role: 'admin', // tenant rules won't fire even with tenant data
      userId: 'u1',
      tenantId: 't1',
      now: fixedNow,
    });
    expect(triggers.some((t) => t.kind.startsWith('tenant.'))).toBe(false);
  });
});
