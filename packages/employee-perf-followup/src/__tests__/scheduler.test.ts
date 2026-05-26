import { describe, it, expect } from 'vitest';
import {
  dateStringInTimezone,
  isInQuietHours,
  previousDateStringInTimezone,
  runDailyPerfCronOnce,
  timeOfDayInTimezone,
  type DailyPerfCronDeps,
  type EmployeeRoster,
} from '../scheduler/daily-perf-cron.js';
import {
  buildAllSeedTemplates,
  buildSeedTemplate,
} from '../kpi/role-templates.js';
import { createInMemoryScorecardRepository } from '../repositories/scorecard.js';
import { createInMemoryKpiTemplateRepository } from '../repositories/kpi-template.js';
import { createInMemoryPerfNudgeRepository } from '../repositories/nudge.js';
import {
  createInMemoryAuditChain,
  stableHash,
} from '../audit/in-memory-audit-chain.js';
import {
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  type KpiMeasurementPort,
  type OrgScopeResolver,
  type VoiceModeReader,
} from '../types.js';

const TZ = 'Africa/Dar_es_Salaam'; // UTC+3 year-round

function fakeRoster(
  employees: ReadonlyArray<{ user_id: string; role: string; timezone: string }>,
): EmployeeRoster {
  return {
    async listEmployees() {
      return employees;
    },
  };
}

function fakeMeasurementPort(
  byUser: Record<string, Record<string, number>>,
): KpiMeasurementPort {
  return {
    async measure(input) {
      const userMeasurements =
        byUser[input.employee_user_id] ?? byUser['__default__'] ?? {};
      const v = userMeasurements[input.measure_fn_name];
      if (v === undefined) {
        throw new Error(
          `no measurement for ${input.employee_user_id}/${input.measure_fn_name}`,
        );
      }
      return v;
    },
  };
}

const HAPPY_MEASUREMENTS: Record<string, number> = {
  tonnage_pct_of_plan: 0.98,
  safety_incidents_count: 0,
  briefings_on_time_pct: 1.0,
  stockpile_reconciliation_pct: 0.98,
  surveys_completed_pct: 1.0,
  assay_drift_pct: 0.015,
  sample_chain_pct: 1.0,
  note_quality_score: 0.85,
  trips_on_time_pct: 0.97,
  fuel_efficiency_ratio: 1.05,
  pre_trip_inspection_pct: 1.0,
  filings_on_time_pct: 1.0,
  reconciliation_pct: 0.99,
  documentation_completeness_score: 0.95,
  variance_turnaround_hours: 2,
  tier2_turnaround_hours: 12,
  portfolio_production_pct: 0.97,
  cash_runway_ratio: 1.05,
  portfolio_compliance_pct: 1.0,
};

const fakeOrg: OrgScopeResolver = {
  async resolveDirectSupervisor(_t, user_id) {
    if (user_id === 'u-foreman') return 'u-supervisor';
    return null;
  },
  async resolveOwner() {
    return 'u-owner';
  },
};

const fakeVoice: VoiceModeReader = {
  async readMode() {
    return 'balanced';
  },
};

function deterministicId(): () => string {
  let n = 0;
  return () => {
    n += 1;
    const padded = n.toString().padStart(12, '0');
    return `00000000-0000-0000-0000-${padded}`;
  };
}

async function buildDeps(
  now: Date,
  employees: ReadonlyArray<{ user_id: string; role: string; timezone: string }>,
): Promise<DailyPerfCronDeps> {
  const templates = createInMemoryKpiTemplateRepository();
  for (const t of buildAllSeedTemplates(now.toISOString())) {
    await templates.upsert(t);
  }
  return {
    roster: fakeRoster(employees),
    templates,
    scorecards: createInMemoryScorecardRepository(),
    nudges: createInMemoryPerfNudgeRepository(),
    orgScope: fakeOrg,
    voice: fakeVoice,
    measurementPort: fakeMeasurementPort({ __default__: HAPPY_MEASUREMENTS }),
    audit: createInMemoryAuditChain(),
    clock: () => now,
    hash: (p) => stableHash(p),
    newId: deterministicId(),
  };
}

describe('time-of-day helpers', () => {
  it('returns the correct local hour in a known timezone', () => {
    // 03:00 UTC corresponds to 06:00 in Africa/Dar_es_Salaam (UTC+3).
    const tod = timeOfDayInTimezone(
      new Date('2026-05-27T03:00:00.000Z'),
      TZ,
    );
    expect(tod.hour).toBe(6);
    expect(tod.minute).toBe(0);
  });

  it('isInQuietHours wraps 18:00→06:00 correctly', () => {
    const start = 18 * 60;
    const end = 6 * 60;
    expect(isInQuietHours(20 * 60, start, end)).toBe(true);
    expect(isInQuietHours(2 * 60, start, end)).toBe(true);
    expect(isInQuietHours(10 * 60, start, end)).toBe(false);
    expect(isInQuietHours(5 * 60 + 59, start, end)).toBe(true);
    expect(isInQuietHours(6 * 60, start, end)).toBe(false);
  });

  it('dateStringInTimezone returns the local date', () => {
    // 22:30 UTC = 01:30 local in UTC+3 → "next day" local.
    const d = dateStringInTimezone(
      new Date('2026-05-26T22:30:00.000Z'),
      TZ,
    );
    expect(d).toBe('2026-05-27');
  });

  it('previousDateStringInTimezone subtracts one day', () => {
    const prev = previousDateStringInTimezone(
      new Date('2026-05-27T03:00:00.000Z'),
      TZ,
    );
    expect(prev).toBe('2026-05-26');
  });
});

describe('runDailyPerfCronOnce — fires at 06:00 local', () => {
  it('fires for a foreman whose local time is 06:00', async () => {
    const now = new Date('2026-05-27T03:00:00.000Z'); // 06:00 local in UTC+3
    const employees = [
      { user_id: 'u-foreman', role: 'foreman', timezone: TZ },
    ];
    const deps = await buildDeps(now, employees);
    const result = await runDailyPerfCronOnce('t1', deps);
    expect(result.fired.length).toBe(1);
    expect(result.fired[0]?.employee_user_id).toBe('u-foreman');
    // Subject + supervisor + owner = 3 nudges.
    expect(result.fired[0]?.nudges_emitted).toBe(3);
    expect(result.skipped.length).toBe(0);
    const nudges = await deps.nudges.listForScorecard(
      result.fired[0]!.scorecard_id,
    );
    expect(nudges.length).toBe(3);
    const tiers = nudges.map((n) => n.recipient_tier);
    expect(tiers).toContain('subject');
    expect(tiers).toContain('supervisor');
    expect(tiers).toContain('owner');
  });
});

describe('runDailyPerfCronOnce — honours 18:00→06:00 quiet hours', () => {
  it('skips employees whose local time is inside the quiet window', async () => {
    // 17:00 UTC = 20:00 local in UTC+3 — inside quiet hours.
    const now = new Date('2026-05-27T17:00:00.000Z');
    const employees = [
      { user_id: 'u-foreman', role: 'foreman', timezone: TZ },
    ];
    const deps = await buildDeps(now, employees);
    const result = await runDailyPerfCronOnce('t1', deps);
    expect(result.fired.length).toBe(0);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.reason).toBe('quiet_hours_queued');
  });
});

describe('runDailyPerfCronOnce — idempotent', () => {
  it('skips employees whose scorecard for the date already exists', async () => {
    const now = new Date('2026-05-27T03:00:00.000Z');
    const employees = [
      { user_id: 'u-foreman', role: 'foreman', timezone: TZ },
    ];
    const deps = await buildDeps(now, employees);
    const first = await runDailyPerfCronOnce('t1', deps);
    expect(first.fired.length).toBe(1);
    const second = await runDailyPerfCronOnce('t1', deps);
    expect(second.fired.length).toBe(0);
    expect(second.skipped.length).toBe(1);
    expect(second.skipped[0]?.reason).toBe('already_processed');
  });
});

describe('QUIET_HOURS constants match FOUNDER_LOCKED §1', () => {
  it('exports 18:00 and 06:00', () => {
    expect(QUIET_HOURS_START).toBe('18:00');
    expect(QUIET_HOURS_END).toBe('06:00');
  });
});

describe('buildSeedTemplate — tonnage hauled is in foreman', () => {
  it('appears as foreman.tonnage_hauled_pct_of_plan', () => {
    const t = buildSeedTemplate('foreman', '2026-05-27T00:00:00.000Z');
    const ids = t.kpi_definitions.map((k) => k.id);
    expect(ids).toContain('foreman.tonnage_hauled_pct_of_plan');
    expect(ids).toContain('foreman.safety_incidents');
  });
});
