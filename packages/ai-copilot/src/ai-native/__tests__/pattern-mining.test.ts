import { describe, it, expect } from 'vitest';
import {
  createPatternMiner,
  enforcePrivacyFloor,
  type PatternMiningRepository,
  type AggregateRow,
} from '../pattern-mining/index.js';
import {
  DEGRADED_MODEL_VERSION,
  MIN_TENANTS_FOR_AGGREGATION,
  type ClassifyLLMPort,
} from '../shared.js';

function makeRepo(rows: AggregateRow[]): PatternMiningRepository {
  return {
    async loadAggregates() {
      return rows;
    },
  };
}

describe('pattern-mining', () => {
  it('enforcePrivacyFloor suppresses rows with <5 tenants', () => {
    const rows: AggregateRow[] = [
      { segmentKey: 'A', metricKey: 'x', value: 1, tenantCount: 3, sampleCount: 10 },
      { segmentKey: 'B', metricKey: 'x', value: 2, tenantCount: 8, sampleCount: 20 },
    ];
    const filtered = enforcePrivacyFloor(rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].segmentKey).toBe('B');
    expect(MIN_TENANTS_FOR_AGGREGATION).toBe(5);
  });

  it('runWeekly returns LLM-derived insights when port is live', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({
            insights: [
              {
                title: 'High complaints drive churn',
                description: 'Properties with monthly complaints >3 show 2.4x churn.',
                affectedSegments: ['A', 'B'],
                confidence: 0.78,
              },
            ],
          }),
          modelVersion: 'claude',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const svc = createPatternMiner({
      repo: makeRepo([
        { segmentKey: 'A', metricKey: 'churn', value: 0.24, tenantCount: 10, sampleCount: 100 },
        { segmentKey: 'B', metricKey: 'churn', value: 0.1, tenantCount: 12, sampleCount: 120 },
      ]),
      llm,
    });
    const insights = await svc.runWeekly();
    expect(insights).toHaveLength(1);
    expect(insights[0].title).toContain('complaints');
    expect(insights[0].confidence).toBeCloseTo(0.78);
    expect(insights[0].modelVersion).toBe('claude');
  });

  it('returns empty when all aggregates are below privacy floor', async () => {
    const svc = createPatternMiner({
      repo: makeRepo([
        { segmentKey: 'A', metricKey: 'churn', value: 1, tenantCount: 2, sampleCount: 10 },
      ]),
    });
    const insights = await svc.runWeekly();
    expect(insights).toHaveLength(0);
  });

  it('emits degraded stub when LLM port is missing but aggregates pass', async () => {
    const svc = createPatternMiner({
      repo: makeRepo([
        { segmentKey: 'A', metricKey: 'churn', value: 0.2, tenantCount: 8, sampleCount: 80 },
      ]),
    });
    const insights = await svc.runWeekly();
    expect(insights).toHaveLength(1);
    expect(insights[0].modelVersion).toBe(DEGRADED_MODEL_VERSION);
    expect(insights[0].confidence).toBe(0);
  });
});
