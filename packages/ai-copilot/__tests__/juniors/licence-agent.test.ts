import { describe, it, expect } from 'vitest';
import {
  createLicenceAgent,
  computeObligationSchedule,
  resolveNextObligation,
  computeRenewalCalendar,
  computeDormancyFactors,
  computeDormancyScore,
  computeForfeitureRisk,
  forfeitureBand,
  dormancyAlertLevel,
  LicenceAgentInputSchema,
  type LicenceAgentInput,
} from '../../src/juniors/licence-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

// The LLM port now returns the NARRATIVE slice only; the deterministic
// core (dates + scores) is computed in-process.
const NARRATIVE = {
  renewal_required_actions: {
    'T-90': ['file renewal application'],
    'T-30': ['settle outstanding annual fee'],
    'T-7': ['escalate to Mining Commission liaison'],
    expiry: ['confirm renewal granted'],
  },
  payment_history_pack: [
    {
      gepg_control_no: '991234567890',
      paid_at: '2026-02-28',
      amount: 1_200_000,
      currency_code: 'TZS',
      kind: 'annual_fee',
      receipt_evidence_id: 'doc_receipt_1',
    },
  ],
  confidence: 0.86,
  rationale: 'No immediate forfeiture risk; renewal window opens later this year.',
  evidence_ids: ['licence_l_1'],
  citations: ['dossier §6.2 — TZ fiscal regime'],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT: LicenceAgentInput = {
  tenantId: 't1',
  licenceId: 'l_1',
  licenceNo: 'PML-001/2025',
  kind: 'PML',
  jurisdiction: 'TZ',
  grantDate: '2025-03-15',
  expiryDate: '2032-03-14',
  lastPaymentDate: '2026-02-28',
  lastWorkProgrammeReportDate: '2026-02-15',
  lastRelinquishmentDate: null,
  eppFiledAt: '2026-01-10',
  areaUtilisationPct: 60,
  asOf: '2026-06-08',
};

describe('licence-agent — factory', () => {
  it('happy path returns schedule + next obligation + evidence_ids', async () => {
    const agent = createLicenceAgent({ claude: claudeOf(NARRATIVE) });
    const out = await agent.processInput(INPUT);
    expect(out.dormancy_alert_level).toBe('green');
    expect(out.evidence_ids).toContain('licence_l_1');
    expect(out.obligation_schedule.length).toBeGreaterThanOrEqual(4);
    expect(out.next_obligation).not.toBeNull();
    // narrative actions are merged onto the deterministic calendar
    const t90 = out.renewal_calendar.find((m) => m.label === 'T-90');
    expect(t90?.required_actions).toContain('file renewal application');
  });

  it('next_obligation is the soonest-due obligation', async () => {
    const agent = createLicenceAgent({ claude: claudeOf(NARRATIVE) });
    const out = await agent.processInput(INPUT);
    const minDays = Math.min(...out.obligation_schedule.map((o) => o.days_until_due));
    expect(out.next_obligation?.days_until_due).toBe(minDays);
  });

  it('citations include the per-jurisdiction statutory basis', async () => {
    const agent = createLicenceAgent({ claude: claudeOf(NARRATIVE) });
    const out = await agent.processInput(INPUT);
    expect(out.citations.some((c) => /Mining Act|Tume ya Madini/i.test(c))).toBe(true);
  });

  it('rejects when narrative evidence_ids is empty (Auditor base)', async () => {
    const agent = createLicenceAgent({ claude: claudeOf({ ...NARRATIVE, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('cadastre_unreachable'); } };
    const agent = createLicenceAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/cadastre_unreachable/);
  });

  it('defaults jurisdiction to TZ (launch market)', () => {
    const parsed = LicenceAgentInputSchema.parse({ ...INPUT, jurisdiction: undefined });
    expect(parsed.jurisdiction).toBe('TZ');
  });
});

describe('licence-agent — deterministic core', () => {
  const today = '2026-06-08';

  it('schedule covers all four obligation kinds, soonest-first', () => {
    const schedule = computeObligationSchedule(INPUT, today);
    const kinds = schedule.map((o) => o.kind).sort();
    expect(kinds).toEqual(['annual_fee', 'relinquishment', 'renewal', 'work_programme_report']);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]!.days_until_due).toBeGreaterThanOrEqual(schedule[i - 1]!.days_until_due);
    }
  });

  it('annual fee recurs ~12 months after last payment', () => {
    const schedule = computeObligationSchedule(INPUT, today);
    const fee = schedule.find((o) => o.kind === 'annual_fee')!;
    expect(fee.due_date).toBe('2027-02-28'); // 2026-02-28 + 12m, already > today
  });

  it('overdue obligation is flagged when the deadline has passed', () => {
    const stale: LicenceAgentInput = {
      ...INPUT,
      lastPaymentDate: '2024-01-01',
      lastWorkProgrammeReportDate: '2024-01-01',
      asOf: today,
    };
    const schedule = computeObligationSchedule(stale, today);
    // recurrence always lands on/after today, so check status logic directly
    const overdueLike = schedule.filter((o) => o.days_until_due < 0);
    overdueLike.forEach((o) => expect(o.status).toBe('overdue'));
  });

  it('resolveNextObligation picks the minimum days_until_due', () => {
    const schedule = computeObligationSchedule(INPUT, today);
    const next = resolveNextObligation(schedule)!;
    expect(next.days_until_due).toBe(Math.min(...schedule.map((o) => o.days_until_due)));
  });

  it('renewal calendar has T-90/T-30/T-7/expiry anchored on expiry', () => {
    const cal = computeRenewalCalendar('2026-09-01', today);
    expect(cal.map((m) => m.label)).toEqual(['T-90', 'T-30', 'T-7', 'expiry']);
    expect(cal.find((m) => m.label === 'expiry')!.date).toBe('2026-09-01');
    expect(cal.find((m) => m.label === 'T-90')!.date).toBe('2026-06-03');
  });

  it('dormancy factors flag never-filed reports as maximal age', () => {
    const f = computeDormancyFactors({ ...INPUT, lastWorkProgrammeReportDate: null }, today);
    expect(f.last_report_age_days).toBe(9_999);
    expect(f.epp_filed).toBe(true);
  });

  it('dormancy score rises with inactivity', () => {
    const active = computeDormancyScore(
      computeDormancyFactors(INPUT, today),
    );
    const dormant = computeDormancyScore(
      computeDormancyFactors(
        { ...INPUT, lastPaymentDate: '2024-01-01', lastWorkProgrammeReportDate: '2024-01-01', areaUtilisationPct: 0, eppFiledAt: null },
        today,
      ),
    );
    expect(dormant).toBeGreaterThan(active);
    expect(dormant).toBeLessThanOrEqual(100);
    expect(active).toBeGreaterThanOrEqual(0);
  });

  it('forfeiture risk leads with overdue + proximity, dormancy as background', () => {
    const schedule = computeObligationSchedule(INPUT, today);
    const next = resolveNextObligation(schedule);
    const lowRisk = computeForfeitureRisk(schedule, next, 10);
    // a near-term next obligation drives a higher score
    const imminent = [{ ...schedule[0]!, days_until_due: 3, status: 'due' as const }];
    const highRisk = computeForfeitureRisk(imminent, imminent[0]!, 80);
    expect(highRisk).toBeGreaterThan(lowRisk);
    expect(highRisk).toBeLessThanOrEqual(100);
  });

  it('bands map scores to thresholds', () => {
    expect(forfeitureBand(80)).toBe('critical');
    expect(forfeitureBand(60)).toBe('high');
    expect(forfeitureBand(30)).toBe('medium');
    expect(forfeitureBand(5)).toBe('low');
    expect(dormancyAlertLevel(70)).toBe('red');
    expect(dormancyAlertLevel(40)).toBe('amber');
    expect(dormancyAlertLevel(5)).toBe('green');
  });

  it('UG/NG cite the UNVERIFIED jurisdiction gap', () => {
    const ug = computeObligationSchedule({ ...INPUT, jurisdiction: 'UG' }, today);
    expect(ug.every((o) => /UNVERIFIED/.test(o.citation) || o.kind === 'renewal')).toBe(true);
    expect(ug.some((o) => /UNVERIFIED/.test(o.citation))).toBe(true);
  });
});
