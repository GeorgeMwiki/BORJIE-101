/**
 * Domain-skill unit tests.
 *
 * Structural tests — no LLM calls. Every assertion is on the deterministic
 * reducer/classifier/ranker logic.
 */

import { describe, it, expect } from 'vitest';
import {
  // offtake
  abstractOfftake,
  proposeRenewalOptions,
  // maintenance
  triageMaintenance,
  rankAssignees,
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

describe('offtake.abstract', () => {
  it('extracts price, performance bond, and party names from a simple agreement', () => {
    const text = [
      'OFFTAKE AGREEMENT',
      'Owner: John Mwangi',
      'Buyer: Asha Wanjiku',
      'Consignment: A-12',
      'Commencement date: 01/03/2026',
      'End date: 28/02/2027',
      'Price: TZS 45,000 per shipment',
      'Performance bond: TZS 90,000',
      'Cooperative levy: TZS 5,000',
      'Escalation: 5% per annum',
      'Notice period: 60 days',
      'Renewal clause present.',
      'Penalty applies after 5 days.',
      'Force majeure clause present.',
    ].join('\n');
    const r = abstractOfftake({ documentText: text });
    expect(r.priceMinorUnits).toBe(45_000);
    expect(r.performanceBondMinorUnits).toBe(90_000);
    expect(r.cooperativeLevyMinorUnits).toBe(5_000);
    expect(r.escalationPct).toBe(5);
    expect(r.noticePeriodDays).toBe(60);
    expect(r.renewalClausePresent).toBe(true);
    expect(r.penaltyClausePresent).toBe(true);
    expect(r.forceMajeureClausePresent).toBe(true);
    expect(r.consignment).toBe('A-12');
  });

  it('flags missing fields', () => {
    const r = abstractOfftake({ documentText: 'hello' });
    expect(r.flags).toContain('no_price_amount_detected');
    expect(r.flags).toContain('offtake_dates_incomplete');
  });
});

describe('offtake.renewal_propose', () => {
  it('recommends conservative when buyer has poor payment score', () => {
    const r = proposeRenewalOptions({
      offtakeId: 'O1',
      currentPriceMinorUnits: 30_000,
      marketMedianPriceMinorUnits: 35_000,
      buyerPaymentScore: 0.3,
      buyerTenureMonths: 12,
      availableCapacityRisk: 0.2,
      maxIncreasePct: 0.1,
    });
    expect(r.recommended).toBe('conservative');
    expect(r.options).toHaveLength(3);
  });

  it('recommends premium for long-tenure excellent payer with low available-capacity risk', () => {
    const r = proposeRenewalOptions({
      offtakeId: 'O1',
      currentPriceMinorUnits: 30_000,
      marketMedianPriceMinorUnits: 35_000,
      buyerPaymentScore: 0.9,
      buyerTenureMonths: 36,
      availableCapacityRisk: 0.05,
      maxIncreasePct: 0.15,
    });
    expect(r.recommended).toBe('premium');
  });

  it('caps increases at maxIncreasePct', () => {
    const r = proposeRenewalOptions({
      offtakeId: 'O1',
      currentPriceMinorUnits: 30_000,
      marketMedianPriceMinorUnits: 60_000, // huge market gap
      buyerPaymentScore: 0.8,
      buyerTenureMonths: 12,
      availableCapacityRisk: 0.1,
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
        sites: [
          { name: 'Geita North Pit', city: 'Geita', type: 'open_pit' },
          { name: 'Mwanza Plant', city: 'Mwanza', type: 'processing' },
        ],
        employees: [
          { first_name: 'John', last_name: 'Mwangi', title: 'Driller', phone: '0712000002' },
        ],
        departments: [{ code: 'OPS', name: 'Operations' }],
        teams: [{ code: 'MAINT', name: 'Maintenance', department: 'OPS', kind: 'maintenance' }],
      },
    });
    expect(b.sites).toHaveLength(2);
    expect(b.employees).toHaveLength(1);
    expect(b.employees[0].firstName).toBe('John');
    expect(b.teams[0].kind).toBe('maintenance');
  });

  it('diffs against existing state', () => {
    const bundle = {
      sites: [{ name: 'Existing' }, { name: 'New One' }],
      employees: [],
      departments: [],
      teams: [],
    };
    const d = migrationDiff({
      bundle,
      existing: {
        siteNames: ['Existing'],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
    });
    expect(d.toAdd.sites).toBe(1);
    expect(d.toSkip).toBe(1);
  });

  it('warns about team referencing unknown department', () => {
    const bundle = {
      sites: [],
      employees: [],
      departments: [],
      teams: [{ code: 'T-9', name: 'Ghost Team', departmentCode: 'GHOST', kind: 'custom' }],
    };
    const d = migrationDiff({ bundle });
    expect(d.warnings.some((w) => w.includes('GHOST'))).toBe(true);
  });
});

describe('eval scenario bundle', () => {
  it('exposes GOLDEN, EXTENDED, and ALL_SCENARIOS', () => {
    // Floor lowered 30 -> 29: the property service-charge scenario was retired
    // with skill.kenya.service_charge_reconcile (D24 domain purity).
    expect(GOLDEN_SCENARIOS.length).toBeGreaterThanOrEqual(29);
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
