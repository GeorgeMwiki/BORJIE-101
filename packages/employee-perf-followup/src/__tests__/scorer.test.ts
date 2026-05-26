import { describe, it, expect } from 'vitest';
import { bandFor, computeScorecard } from '../score/scorer.js';
import { buildSeedTemplate, validateRoleTemplate } from '../kpi/role-templates.js';
import type {
  KpiMeasurementInput,
  KpiMeasurementPort,
  ScoreDeps,
} from '../types.js';
import { stableHash } from '../audit/in-memory-audit-chain.js';

const NOW = new Date('2026-05-27T06:00:00.000Z');

function deps(measurementsByFn: Record<string, number>): ScoreDeps {
  const port: KpiMeasurementPort = {
    async measure(input: KpiMeasurementInput): Promise<number> {
      const v = measurementsByFn[input.measure_fn_name];
      if (v === undefined) {
        throw new Error(`no measurement for ${input.measure_fn_name}`);
      }
      return v;
    },
  };
  let counter = 0;
  return {
    measurementPort: port,
    now: () => NOW,
    hash: (p) => stableHash(p),
    newId: () => {
      counter += 1;
      const padded = counter.toString().padStart(12, '0');
      return `00000000-0000-0000-0000-${padded}`;
    },
  };
}

describe('bandFor — direction maps', () => {
  it('maps higher_is_better ratios to the 5-band scale', () => {
    expect(bandFor(1.15, 1, 'higher_is_better')).toBe(1.0);
    expect(bandFor(1.05, 1, 'higher_is_better')).toBe(0.9);
    expect(bandFor(0.98, 1, 'higher_is_better')).toBe(0.7);
    expect(bandFor(0.85, 1, 'higher_is_better')).toBe(0.4);
    expect(bandFor(0.5, 1, 'higher_is_better')).toBe(0.0);
  });

  it('maps lower_is_better ratios to the 5-band scale', () => {
    expect(bandFor(0.4, 1, 'lower_is_better')).toBe(1.0);
    expect(bandFor(0.95, 1, 'lower_is_better')).toBe(0.9);
    expect(bandFor(1.04, 1, 'lower_is_better')).toBe(0.7);
    expect(bandFor(1.15, 1, 'lower_is_better')).toBe(0.4);
    expect(bandFor(1.5, 1, 'lower_is_better')).toBe(0.0);
  });

  it('handles target=0 lower_is_better (e.g. safety incidents)', () => {
    expect(bandFor(0, 0, 'lower_is_better')).toBe(1.0);
    expect(bandFor(1, 0, 'lower_is_better')).toBe(0.4);
    expect(bandFor(3, 0, 'lower_is_better')).toBe(0.0);
  });

  it('handles binary_target direction', () => {
    expect(bandFor(1, 1, 'binary_target')).toBe(1.0);
    expect(bandFor(0.8, 1, 'binary_target')).toBe(0.0);
  });
});

describe('computeScorecard — foreman role', () => {
  it('produces an overall_score consistent with weighted bands', async () => {
    const template = buildSeedTemplate('foreman', NOW.toISOString());
    validateRoleTemplate(template);
    const measurements = {
      // tonnage hauled — target 0.95, raw 0.98 → ratio 1.03 → band 0.9
      tonnage_pct_of_plan: 0.98,
      // safety_incidents — target 0, raw 0 → band 1.0
      safety_incidents_count: 0,
      // briefings — target 1.0, raw 1.0 → band 0.9
      briefings_on_time_pct: 1.0,
      // stockpile — target 0.98, raw 0.97 → ratio 0.99 → band 0.7
      stockpile_reconciliation_pct: 0.97,
    };
    const card = await computeScorecard(
      {
        tenant_id: 't1',
        employee_user_id: 'u-foreman',
        role: 'foreman',
        date: '2026-05-26',
        template,
      },
      deps(measurements),
    );
    // 0.45*0.9 + 0.30*1.0 + 0.15*0.9 + 0.10*0.7 = 0.91
    expect(card.overall_score).toBeCloseTo(0.91, 3);
    expect(card.kpis.length).toBe(4);
    expect(card.audit_hash.length).toBeGreaterThan(0);
    expect(card.prev_hash).toBe('');
  });
});

describe('computeScorecard — geologist role weights', () => {
  it('weights sum to 1.0 exactly', () => {
    const template = buildSeedTemplate('geologist', NOW.toISOString());
    const sum = template.kpi_definitions.reduce((s, k) => s + k.weight, 0);
    expect(sum).toBeCloseTo(1.0, 9);
    expect(() => validateRoleTemplate(template)).not.toThrow();
  });
});

describe('computeScorecard — driver role with anomaly', () => {
  it('flags a missed-band KPI as an anomaly in signals', async () => {
    const template = buildSeedTemplate('driver', NOW.toISOString());
    const measurements = {
      trips_on_time_pct: 0.7, // ratio 0.74 → band 0.0 (missed)
      fuel_efficiency_ratio: 1.05, // band 0.9
      safety_incidents_count: 0, // band 1.0
      pre_trip_inspection_pct: 1.0, // band 0.9
    };
    const card = await computeScorecard(
      {
        tenant_id: 't1',
        employee_user_id: 'u-driver',
        role: 'driver',
        date: '2026-05-26',
        template,
      },
      deps(measurements),
    );
    const signals = card.signals as { anomalies?: string[] };
    expect(signals.anomalies).toContain(
      'kpi_missed:driver.trips_on_time_pct',
    );
    expect(card.overall_score).toBeLessThan(0.7);
  });
});

describe('computeScorecard — accountant binary filing', () => {
  it('treats filings_on_time_pct as binary_target band', async () => {
    const template = buildSeedTemplate('accountant', NOW.toISOString());
    const measurements = {
      filings_on_time_pct: 1.0, // binary → 1.0 (full)
      reconciliation_pct: 1.0,
      documentation_completeness_score: 1.0,
      variance_turnaround_hours: 2,
    };
    const card = await computeScorecard(
      {
        tenant_id: 't1',
        employee_user_id: 'u-acc',
        role: 'accountant',
        date: '2026-05-26',
        template,
      },
      deps(measurements),
    );
    // Missing one filing should drop the whole binary band to 0.
    const filingsKpi = card.kpis.find(
      (k) => k.kpi_id === 'accountant.filings_on_time_pct',
    );
    expect(filingsKpi?.band).toBe(1.0);
    expect(card.overall_score).toBeGreaterThan(0.9);

    // Now retry with one filing missed.
    const missed = await computeScorecard(
      {
        tenant_id: 't1',
        employee_user_id: 'u-acc',
        role: 'accountant',
        date: '2026-05-26',
        template,
      },
      deps({ ...measurements, filings_on_time_pct: 0.8 }),
    );
    const missedKpi = missed.kpis.find(
      (k) => k.kpi_id === 'accountant.filings_on_time_pct',
    );
    expect(missedKpi?.band).toBe(0.0);
  });
});
