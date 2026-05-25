import { describe, expect, it } from 'vitest';
import {
  SCENARIO_IDS,
  buildScenario,
  buildRentForecastScenario,
  buildVacancyForecastScenario,
  buildChurnForecastScenario,
} from '../scenarios.ts';

describe('scenarios', () => {
  it('exposes a stable scenario id list', () => {
    expect(SCENARIO_IDS).toEqual(['rent_forecast', 'vacancy_forecast', 'churn_forecast']);
  });

  it.each(SCENARIO_IDS)('builds %s with non-empty series and a config that can plan folds', (id) => {
    const scenario = buildScenario(id);
    expect(scenario.id).toBe(id);
    expect(scenario.series.length).toBeGreaterThan(0);
    expect(scenario.seasonality).toBeGreaterThanOrEqual(1);
    expect(scenario.config.horizon).toBeGreaterThanOrEqual(1);
    expect(scenario.config.minTrainSize).toBeGreaterThanOrEqual(1);
    for (const s of scenario.series) {
      expect(s.values.length).toBeGreaterThan(scenario.config.minTrainSize);
      expect(s.seasonality).toBe(scenario.seasonality);
    }
  });

  it('produces deterministic output across runs (rent_forecast)', () => {
    const a = buildRentForecastScenario({ tenantCount: 2, unitsPerTenant: 1, months: 24, seed: 7 });
    const b = buildRentForecastScenario({ tenantCount: 2, unitsPerTenant: 1, months: 24, seed: 7 });
    expect(a.series.map((s) => s.values)).toEqual(b.series.map((s) => s.values));
  });

  it('churn_forecast values remain bounded inside [0, 1]', () => {
    const scenario = buildChurnForecastScenario({ tenantCount: 3, cohortsPerTenant: 2, quarters: 24, seed: 1 });
    for (const s of scenario.series) {
      for (const v of s.values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('vacancy_forecast values are non-negative', () => {
    const scenario = buildVacancyForecastScenario({ tenantCount: 2, propertiesPerTenant: 2, days: 60, seed: 2 });
    for (const s of scenario.series) {
      for (const v of s.values) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
