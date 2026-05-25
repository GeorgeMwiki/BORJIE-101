/**
 * Foundation-model adapter ports — deterministic mock-driven tests.
 *
 * Adapters are mostly orchestration around an injected network. We
 * test:
 *   - factory rejects missing creds
 *   - happy-path returns a well-formed TimeSeriesForecast
 *   - response-shape validator catches mismatched lengths + non-finite
 *   - LLM adapter parses + validates JSON output
 *   - deterministic mock helper produces stable outputs
 */

import { describe, it, expect } from 'vitest';
import {
  createChronosAdapter,
  createTimesFMAdapter,
  createTimeGPTAdapter,
  createLLMForecaster,
  createDeterministicMockNetwork,
  type TimeSeries,
  type Horizon,
  type FoundationModelNetwork,
  type LLMBrain,
} from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function makeSeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'adapter-fixture',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

const HORIZON_3: Horizon = { steps: 3 };

describe('adapters / chronos', () => {
  it('rejects when neither endpoint nor network is supplied', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createChronosAdapter({} as any)).toThrow();
  });

  it('round-trips a deterministic mock response', async () => {
    const net = createDeterministicMockNetwork('chronos-mock-1');
    const adapter = createChronosAdapter({
      endpoint: 'https://chronos.example/predict',
      network: net,
    });
    const out = await adapter.predict({
      series: makeSeries([1, 2, 3, 4, 5]),
      horizon: HORIZON_3,
    });
    expect(out.modelKind).toBe('chronos');
    expect(out.modelVersion).toBe('chronos-mock-1');
    expect(out.points).toHaveLength(3);
    expect(out.points[0]!.point).toBeCloseTo(3, 5); // mean of 1..5
  });

  it('caps interval lower ≤ upper invariant violations from the network', async () => {
    const broken: FoundationModelNetwork = async () => ({
      points: [1, 2, 3],
      lower:  [5, 5, 5],
      upper:  [1, 1, 1],
      modelVersion: 'broken-1',
    });
    const adapter = createChronosAdapter({
      endpoint: 'https://chronos.example/predict',
      network: broken,
    });
    await expect(
      adapter.predict({ series: makeSeries([1, 2, 3]), horizon: HORIZON_3 }),
    ).rejects.toThrow(/lower/);
  });

  it('rejects non-finite values from the network', async () => {
    const broken: FoundationModelNetwork = async () => ({
      points: [1, NaN, 3],
      lower:  [0, 0, 0],
      upper:  [2, 2, 2],
      modelVersion: 'broken-2',
    });
    const adapter = createChronosAdapter({
      endpoint: 'https://chronos.example/predict',
      network: broken,
    });
    await expect(
      adapter.predict({ series: makeSeries([1, 2, 3]), horizon: HORIZON_3 }),
    ).rejects.toThrow(/non-finite/);
  });
});

describe('adapters / timesfm', () => {
  it('rejects missing projectId or apiKey', () => {
    expect(() => createTimesFMAdapter({ projectId: '', apiKey: 'x' })).toThrow();
    expect(() => createTimesFMAdapter({ projectId: 'p', apiKey: '' })).toThrow();
  });

  it('predicts via injected mock', async () => {
    const net = createDeterministicMockNetwork('timesfm-mock-1');
    const adapter = createTimesFMAdapter({
      projectId: 'proj-x',
      apiKey: 'key-x',
      network: net,
    });
    const out = await adapter.predict({
      series: makeSeries([100, 110, 120, 130]),
      horizon: HORIZON_3,
    });
    expect(out.modelKind).toBe('timesfm');
    expect(out.points).toHaveLength(3);
    expect(out.points[0]!.point).toBeCloseTo(115, 5);
  });
});

describe('adapters / timegpt', () => {
  it('rejects missing apiKey', () => {
    expect(() => createTimeGPTAdapter({ apiKey: '' })).toThrow();
  });

  it('returns forecast with explicit modelVersion from network', async () => {
    const net: FoundationModelNetwork = async ({ horizon }) => ({
      points: new Array(horizon.steps).fill(7),
      lower:  new Array(horizon.steps).fill(6),
      upper:  new Array(horizon.steps).fill(8),
      modelVersion: 'timegpt-2026.5',
    });
    const adapter = createTimeGPTAdapter({
      apiKey: 'sk-test',
      network: net,
    });
    const out = await adapter.predict({
      series: makeSeries([7, 7, 7]),
      horizon: HORIZON_3,
    });
    expect(out.modelVersion).toBe('timegpt-2026.5');
  });
});

describe('adapters / llm-zero-shot', () => {
  it('parses a valid JSON response from the brain', async () => {
    const brain: LLMBrain = {
      async synthesize() {
        return JSON.stringify({
          points: [1.1, 1.2, 1.3],
          lower:  [0.9, 1.0, 1.1],
          upper:  [1.3, 1.4, 1.5],
        });
      },
    };
    const adapter = createLLMForecaster({ brain });
    const out = await adapter.predict({
      series: makeSeries([1, 1, 1, 1]),
      horizon: HORIZON_3,
    });
    expect(out.points[0]!.point).toBe(1.1);
    expect(out.points[0]!.lower).toBe(0.9);
  });

  it('rejects invalid JSON from the brain', async () => {
    const brain: LLMBrain = {
      async synthesize() {
        return 'not json';
      },
    };
    const adapter = createLLMForecaster({ brain });
    await expect(
      adapter.predict({ series: makeSeries([1, 2]), horizon: HORIZON_3 }),
    ).rejects.toThrow(/JSON/);
  });

  it('rejects wrong-length point arrays', async () => {
    const brain: LLMBrain = {
      async synthesize() {
        return JSON.stringify({
          points: [1, 2],
          lower:  [0, 1],
          upper:  [2, 3],
        });
      },
    };
    const adapter = createLLMForecaster({ brain });
    await expect(
      adapter.predict({ series: makeSeries([1, 2]), horizon: HORIZON_3 }),
    ).rejects.toThrow(/3/);
  });

  it('rejects empty series', async () => {
    const brain: LLMBrain = { async synthesize() { return '{}'; } };
    const adapter = createLLMForecaster({ brain });
    await expect(
      adapter.predict({
        series: { id: 'empty', frequency: 'daily', points: [] },
        horizon: HORIZON_3,
      }),
    ).rejects.toThrow();
  });
});

describe('adapters / deterministic-mock-network', () => {
  it('returns trailing mean point predictions', async () => {
    const net = createDeterministicMockNetwork('m-1');
    const resp = await net({
      series: makeSeries([2, 4, 6, 8, 10]),
      horizon: { steps: 2 },
    });
    expect(resp.points).toEqual([6, 6]);
  });

  it('is fully deterministic across calls', async () => {
    const net = createDeterministicMockNetwork('m-2');
    const a = await net({ series: makeSeries([1, 2, 3]), horizon: { steps: 1 } });
    const b = await net({ series: makeSeries([1, 2, 3]), horizon: { steps: 1 } });
    expect(a.points).toEqual(b.points);
    expect(a.lower).toEqual(b.lower);
    expect(a.upper).toEqual(b.upper);
  });
});
