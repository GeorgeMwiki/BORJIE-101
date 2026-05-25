/**
 * Domain-skill unit tests.
 *
 * Structural tests — no LLM calls. Every assertion is on the deterministic
 * reducer/classifier/ranker logic.
 */

import { describe, it, expect } from 'vitest';
import {
  // leasing
  abstractLease,
  proposeRenewalOptions,
  // maintenance
  triageMaintenance,
  rankAssignees,
  // finance
  draftOwnerStatement,
  draftArrearsNotices,
  // comms
  draftTenantNotices,
  buildCampaign,
  // hr
  assignToTeamMember,
  // migration
  migrationExtract,
  migrationDiff,
  // eval
  ALL_SCENARIOS,
  GOLDEN_SCENARIOS,
  EXTENDED_SCENARIOS,
} from '../index.js';

describe('leasing.abstract', () => {
  it('extracts rent, deposit, and party names from a simple lease', () => {
    const text = [
      'LEASE AGREEMENT',
      'Landlord: John Mwangi',
      'Tenant: Asha Wanjiku',
      'Unit: A-12',
      'Commencement date: 01/03/2026',
      'End date: 28/02/2027',
      'Rent: KES 45,000 per month',
      'Security deposit: KES 90,000',
      'Service charge: KES 5,000',
      'Escalation: 5% per annum',
      'Notice period: 60 days',
      'Renewal clause present.',
      'Late fee applies after 5 days.',
    ].join('\n');
    const r = abstractLease({ documentText: text });
    expect(r.rentKes).toBe(45_000);
    expect(r.depositKes).toBe(90_000);
    expect(r.serviceChargeKes).toBe(5_000);
    expect(r.escalationPct).toBe(5);
    expect(r.noticePeriodDays).toBe(60);
    expect(r.renewalClausePresent).toBe(true);
    expect(r.lateFeeClausePresent).toBe(true);
    expect(r.unit).toBe('A-12');
  });

  it('flags missing fields', () => {
    const r = abstractLease({ documentText: 'hello' });
    expect(r.flags).toContain('no_rent_amount_detected');
    expect(r.flags).toContain('lease_dates_incomplete');
  });
});

describe('leasing.renewal_propose', () => {
  it('recommends conservative when tenant has poor payment score', () => {
    const r = proposeRenewalOptions({
      leaseId: 'L1',
      currentRentKes: 30_000,
      marketMedianRentKes: 35_000,
      tenantPaymentScore: 0.3,
      tenantTenureMonths: 12,
      vacancyRisk: 0.2,
      maxIncreasePct: 0.1,
    });
    expect(r.recommended).toBe('conservative');
    expect(r.options).toHaveLength(3);
  });

  it('recommends premium for long-tenure excellent payer with low vacancy risk', () => {
    const r = proposeRenewalOptions({
      leaseId: 'L1',
      currentRentKes: 30_000,
      marketMedianRentKes: 35_000,
      tenantPaymentScore: 0.9,
      tenantTenureMonths: 36,
      vacancyRisk: 0.05,
      maxIncreasePct: 0.15,
    });
    expect(r.recommended).toBe('premium');
  });

  it('caps increases at maxIncreasePct', () => {
    const r = proposeRenewalOptions({
      leaseId: 'L1',
      currentRentKes: 30_000,
      marketMedianRentKes: 60_000, // huge market gap
      tenantPaymentScore: 0.8,
      tenantTenureMonths: 12,
      vacancyRisk: 0.1,
      maxIncreasePct: 0.1,
    });
    const market = r.options.find((o) => o.label === 'market')!;
    expect(market.increasePct).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});

describe('maintenance.triage', () => {
  it('classifies a burst pipe as plumbing emergency', () => {
    const r = triageMaintenance({
      description: 'burst pipe flooding into the unit below',
      temperature: 0,
    });
    expect(r.category).toBe('plumbing');
    expect(r.severity).toBe('emergency');
    expect(r.isEmergency).toBe(true);
    expect(r.suggestedSlaHours).toBeLessThanOrEqual(2);
  });

  it('classifies a broken fridge as appliance / high', () => {
    const r = triageMaintenance({
      description: 'fridge not working, urgent please',
      temperature: 0,
    });
    expect(r.category).toBe('appliance');
    expect(r.severity).toBe('high');
  });

  it('defaults low severity for generic requests', () => {
    const r = triageMaintenance({
      description: 'the gate needs some paint',
      temperature: 0,
    });
    expect(r.severity).toBe('low');
  });
});

describe('maintenance.assign_work_order', () => {
  it('ranks candidates by skill, load, reliability, proximity', () => {
    const r = rankAssignees({
      workOrderId: 'WO1',
      requiredSkills: ['plumbing'],
      candidates: [
        {
          id: 'V1',
          name: 'Ace Plumbing',
          skills: { plumbing: 0.9 },
          currentOpenJobs: 1,
          completionRate30d: 0.95,
          avgTimeToCloseHours: 24,
          distanceKm: 3,
        },
        {
          id: 'V2',
          name: 'Budget Plumbing',
          skills: { plumbing: 0.6 },
          currentOpenJobs: 5,
          completionRate30d: 0.7,
          avgTimeToCloseHours: 48,
          distanceKm: 10,
        },
      ],
      urgency: 'high',
    });
    expect(r.recommended?.id).toBe('V1');
    expect(r.ranked[0].score).toBeGreaterThan(r.ranked[1].score);
  });

  it('penalizes missing required skill to near-zero score', () => {
    const r = rankAssignees({
      workOrderId: 'WO1',
      requiredSkills: ['electrical'],
      candidates: [
        {
          id: 'V1',
          name: 'Ace',
          skills: { plumbing: 0.9 },
          currentOpenJobs: 0,
          completionRate30d: 1,
          avgTimeToCloseHours: 24,
          distanceKm: 1,
        },
      ],
      urgency: 'medium',
    });
    expect(r.ranked[0].skillMatch).toBe(0);
  });
});

describe('finance.draft_owner_statement', () => {
  it('computes management fee, M-Pesa fees, MRI-net', () => {
    const r = draftOwnerStatement({
      ownerId: 'O1',
      ownerName: 'Mwangi',
      period: '2026-03',
      properties: [
        {
          propertyId: 'P1',
          propertyName: 'Kilimani Heights',
          grossCollectedKes: 100_000,
          arrearsKes: 0,
          expensesKes: 10_000,
          mpesaFeesKes: 500,
        },
      ],
      managementFeePct: 0.08,
      mriWithheldKes: 7_500,
    });
    expect(r.total.managementFeeKes).toBe(8_000);
    expect(r.total.mriWithheldKes).toBe(7_500);
    expect(r.total.netDisbursementKes).toBe(74_000);
    expect(r.rendered).toContain('KES 100,000');
  });
});

describe('finance.draft_arrears_notice', () => {
  it('stratifies by days overdue and escalates risk', () => {
    const r = draftArrearsNotices({
      tenants: [
        { tenantId: 'T1', tenantName: 'Asha', unitLabel: 'A-1', amountKes: 25_000, daysOverdue: 7, locale: 'sw' },
        { tenantId: 'T2', tenantName: 'Brian', unitLabel: 'B-2', amountKes: 40_000, daysOverdue: 30, locale: 'en' },
        { tenantId: 'T3', tenantName: 'Carol', unitLabel: 'C-3', amountKes: 60_000, daysOverdue: 60, locale: 'en' },
      ],
      propertyName: 'Borjie',
      thresholds: { gentleMaxDays: 14, firmMaxDays: 45 },
    });
    expect(r.summary).toEqual({ gentle: 1, firm: 1, legalWarn: 1, totalKes: 125_000 });
    expect(r.drafts[0].riskLevel).toBe('MEDIUM');
    expect(r.drafts[1].riskLevel).toBe('HIGH');
    expect(r.drafts[2].riskLevel).toBe('CRITICAL');
    expect(r.drafts[2].body.toLowerCase()).toMatch(/legal/);
  });
});

describe('comms.draft_tenant_notice', () => {
  it('routes to preferred channel and flags missing contact', () => {
    const r = draftTenantNotices({
      kind: 'rent_reminder_gentle',
      locale: 'sw',
      recipients: [
        {
          tenantId: 'T1',
          tenantName: 'Asha',
          unitLabel: 'A-1',
          phone: '0712000001',
          preferredChannel: 'whatsapp',
        },
        {
          tenantId: 'T2',
          tenantName: 'Brian',
          unitLabel: 'B-2',
          // no contacts
        },
      ],
      defaults: { amountKes: 25_000, date: '2026-03-31', propertyName: 'Borjie' },
      defaultChannel: 'whatsapp',
    });
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].channel).toBe('whatsapp');
    expect(r.recipientsWithoutContact).toEqual(['T2']);
  });

  it('truncates SMS to 160 chars', () => {
    const r = draftTenantNotices({
      kind: 'service_charge_notice',
      locale: 'en',
      recipients: [
        {
          tenantId: 'T1',
          tenantName: 'Asha',
          unitLabel: 'A-1',
          phone: '0712000001',
          preferredChannel: 'sms',
        },
      ],
      defaults: {
        amountKes: 5_000,
        date: '2026-03-31',
        propertyName: 'Kilimani Heights',
      },
      defaultChannel: 'sms',
    });
    expect(r.drafts[0].body.length).toBeLessThanOrEqual(160);
    // Might not truncate if body was already short; this is fine.
  });
});

describe('comms.draft_campaign', () => {
  it('builds a vacancy_fill campaign with steps', () => {
    const r = buildCampaign({
      goal: 'vacancy_fill',
      targetAudienceSize: 50,
      channels: ['whatsapp', 'sms'],
      propertyName: 'Kilimani',
      locale: 'sw',
      budgetKes: 0,
    });
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.estimatedConversion).toBeGreaterThan(0);
    expect(r.kpis.length).toBeGreaterThan(0);
  });
});

describe('hr.assign_to_team_member', () => {
  it('ranks active team members with matching skills first', () => {
    const r = assignToTeamMember({
      taskLabel: 'plumbing repair',
      requiredSkills: ['plumbing'],
      requiredLanguages: ['sw'],
      coveredPropertyId: 'P1',
      teamMembers: [
        {
          employeeId: 'E1',
          name: 'John',
          jobTitle: 'Plumber',
          capabilities: { plumbing: 0.9 },
          languages: ['sw', 'en'],
          coveredPropertyIds: ['P1'],
          currentOpenAssignments: 0,
          performanceScore: 0.9,
          status: 'active',
        },
        {
          employeeId: 'E2',
          name: 'Mary',
          jobTitle: 'Caretaker',
          capabilities: { plumbing: 0.3 },
          languages: ['sw'],
          coveredPropertyIds: ['P2'],
          currentOpenAssignments: 2,
          performanceScore: 0.7,
          status: 'active',
        },
      ],
      urgency: 'high',
    });
    expect(r.recommended?.employeeId).toBe('E1');
  });

  it('excludes ineligible (on_leave, terminated, pending) from recommendation', () => {
    const r = assignToTeamMember({
      taskLabel: 'any task',
      teamMembers: [
        {
          employeeId: 'E1',
          name: 'On Leave',
          jobTitle: 'x',
          capabilities: {},
          languages: [],
          coveredPropertyIds: [],
          currentOpenAssignments: 0,
          performanceScore: 1,
          status: 'on_leave',
        },
      ],
    });
    expect(r.recommended).toBeNull();
    expect(r.ineligibleCount).toBe(1);
  });
});

describe('migration.extract + diff', () => {
  it('extracts from well-named sheets', () => {
    const b = migrationExtract({
      sheets: {
        properties: [
          { name: 'Kilimani Heights', city: 'Nairobi', units: 40 },
        ],
        units: [
          { property: 'Kilimani Heights', unit: 'A-1', bedrooms: 2, rent: 45000 },
          { property: 'Kilimani Heights', unit: 'A-2', bedrooms: 3, rent: 60000 },
        ],
        tenants: [
          { name: 'Asha', unit: 'A-1', phone: '0712000001', rent_kes: 45000 },
        ],
        employees: [
          { first_name: 'John', last_name: 'Mwangi', title: 'Caretaker', phone: '0712000002' },
        ],
        departments: [{ code: 'OPS', name: 'Operations' }],
        teams: [{ code: 'MAINT', name: 'Maintenance', department: 'OPS', kind: 'maintenance' }],
      },
    });
    expect(b.properties).toHaveLength(1);
    expect(b.units).toHaveLength(2);
    expect(b.tenants).toHaveLength(1);
    expect(b.employees).toHaveLength(1);
    expect(b.employees[0].firstName).toBe('John');
    expect(b.teams[0].kind).toBe('maintenance');
  });

  it('diffs against existing state', () => {
    const bundle = {
      properties: [{ name: 'Existing' }, { name: 'New One' }],
      units: [],
      tenants: [],
      employees: [],
      departments: [],
      teams: [],
    };
    const d = migrationDiff({
      bundle,
      existing: {
        propertyNames: ['Existing'],
        unitLabelsByProperty: {},
        tenantNames: [],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
    });
    expect(d.toAdd.properties).toBe(1);
    expect(d.toSkip).toBe(1);
  });

  it('warns about unit referencing unknown property', () => {
    const bundle = {
      properties: [],
      units: [{ propertyName: 'Ghost', label: 'Z-9' }],
      tenants: [],
      employees: [],
      departments: [],
      teams: [],
    };
    const d = migrationDiff({ bundle });
    expect(d.warnings.some((w) => w.includes('Ghost'))).toBe(true);
  });
});

describe('eval scenario bundle', () => {
  it('exposes GOLDEN, EXTENDED, and ALL_SCENARIOS', () => {
    expect(GOLDEN_SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(EXTENDED_SCENARIOS.length).toBeGreaterThan(0);
    expect(ALL_SCENARIOS.length).toBe(
      GOLDEN_SCENARIOS.length + EXTENDED_SCENARIOS.length
    );
  });

  it('all scenarios have unique ids', () => {
    const ids = new Set<string>();
    for (const s of ALL_SCENARIOS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it('all scenarios have at least one turn and expectations', () => {
    for (const s of ALL_SCENARIOS) {
      expect(s.turns.length).toBeGreaterThan(0);
      expect(s.expect).toBeDefined();
    }
  });
});
