import { describe, it, expect } from 'vitest';
import { generateCoachNudge } from '../nudge/coach-nudge.js';
import { buildSeedTemplate } from '../kpi/role-templates.js';
import type { EmployeeScorecard } from '../types.js';

const NOW_ISO = '2026-05-27T06:00:00.000Z';

function makeScorecard(): EmployeeScorecard {
  return {
    id: 'sc-1',
    tenant_id: 't1',
    employee_user_id: 'u-driver',
    date: '2026-05-26',
    role: 'driver',
    kpis: [
      // worst — trips on time band 0
      { kpi_id: 'driver.trips_on_time_pct', raw: 0.7, band: 0, contribution: 0 },
      // best — fuel efficiency band 0.9
      { kpi_id: 'driver.fuel_efficiency_ratio', raw: 1.05, band: 0.9, contribution: 0.225 },
      { kpi_id: 'driver.safety_incidents', raw: 0, band: 1.0, contribution: 0.25 },
      { kpi_id: 'driver.pre_trip_inspection_pct', raw: 1.0, band: 0.9, contribution: 0.09 },
    ],
    overall_score: 0.565,
    signals: { anomalies: ['kpi_missed:driver.trips_on_time_pct'], streak_days: 0, day_over_day_delta: null },
    prev_hash: '',
    audit_hash: 'h1',
    created_at: NOW_ISO,
  };
}

const TEMPLATE = buildSeedTemplate('driver', NOW_ISO);

describe('generateCoachNudge — GUIDE mode', () => {
  it('opens with "I have reviewed yesterday" and offers an approve action', () => {
    const text = generateCoachNudge({
      scorecard: makeScorecard(),
      template: TEMPLATE,
      voice: 'guide',
    });
    expect(text.toLowerCase()).toContain("i've reviewed yesterday's numbers");
    expect(text.toLowerCase()).toContain('approve when ready');
    // The worst KPI must be called out.
    expect(text).toContain('Trips completed on time');
    // The best KPI (highest band) must be celebrated. Safety
    // incidents at zero hits band 1.0 which beats fuel efficiency
    // at band 0.9 — the picker selects the highest band.
    expect(text).toContain('Safety incidents');
  });
});

describe('generateCoachNudge — LEARN mode', () => {
  it('opens with a Socratic "before we draft" prompt and ends with a clarifier', () => {
    const text = generateCoachNudge({
      scorecard: makeScorecard(),
      template: TEMPLATE,
      voice: 'learn',
    });
    expect(text.toLowerCase()).toContain("before we draft today's plan");
    expect(text.toLowerCase()).toContain("walk me through");
    // Should NOT contain the GUIDE-mode "Approve when ready" tail.
    expect(text.toLowerCase()).not.toContain('approve when ready');
  });
});

describe('generateCoachNudge — BALANCED mode', () => {
  it('produces a neutral up/down read with collapsible why/plan affordances', () => {
    const text = generateCoachNudge({
      scorecard: makeScorecard(),
      template: TEMPLATE,
      voice: 'balanced',
    });
    expect(text.toLowerCase()).toContain('quick read on yesterday');
    expect(text.toLowerCase()).toContain('up:');
    expect(text.toLowerCase()).toContain('down:');
    expect(text.toLowerCase()).toContain("tap 'why'");
    expect(text.toLowerCase()).toContain("tap 'plan'");
  });
});

describe('generateCoachNudge — word cap', () => {
  it('produces text under the 180-word cap', () => {
    const text = generateCoachNudge({
      scorecard: makeScorecard(),
      template: TEMPLATE,
      voice: 'guide',
    });
    const words = text.trim().split(/\s+/);
    expect(words.length).toBeLessThanOrEqual(180);
  });
});
