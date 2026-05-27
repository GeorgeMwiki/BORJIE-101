import { describe, expect, it } from 'vitest';
import { runPcmciPlus } from '../discovery/pcmci-plus-port.js';
import { runDowhyAte } from '../estimate/dowhy-port.js';
import {
  CausalInferenceError,
  type PythonSidecarPort,
  type PythonSidecarRequest,
  type PythonSidecarResponse,
} from '../types.js';

function stubSidecar(
  fn: (req: PythonSidecarRequest) => PythonSidecarResponse | null,
): PythonSidecarPort {
  return { call: async (req) => fn(req) };
}

describe('PCMCI+ port', () => {
  it('returns null when port is absent', async () => {
    const r = await runPcmciPlus(null, {
      variables: ['a', 'b'],
      series: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    });
    expect(r).toBeNull();
  });

  it('parses a well-formed sidecar response', async () => {
    const port = stubSidecar(() => ({
      ok: true,
      result: {
        graph: {
          nodes: ['fuel', 'production'],
          edges: [{ from: 'fuel', to: 'production', lag: 1 }],
        },
        p_values: { 'fuel->production@1': 0.003 },
        max_lag: 1,
      },
    }));
    const r = await runPcmciPlus(port, {
      variables: ['fuel', 'production'],
      series: [
        [1, 2, 3, 4, 5],
        [5, 4, 3, 2, 1],
      ],
    });
    expect(r).not.toBeNull();
    expect(r?.graph.nodes).toEqual(['fuel', 'production']);
    expect(r?.graph.edges[0]?.lag).toBe(1);
    expect(r?.maxLag).toBe(1);
  });

  it('throws when sidecar returns ok=false', async () => {
    const port = stubSidecar(() => ({ ok: false, error: 'oops' }));
    await expect(
      runPcmciPlus(port, {
        variables: ['a', 'b'],
        series: [[1, 2], [3, 4]],
      }),
    ).rejects.toBeInstanceOf(CausalInferenceError);
  });

  it('rejects ragged series', async () => {
    const port = stubSidecar(() => ({ ok: true, result: {} }));
    await expect(
      runPcmciPlus(port, {
        variables: ['a', 'b'],
        series: [
          [1, 2, 3],
          [1, 2],
        ],
      }),
    ).rejects.toBeInstanceOf(CausalInferenceError);
  });
});

describe('DoWhy ATE port', () => {
  it('returns null when port is absent', async () => {
    const r = await runDowhyAte(null, {
      graph: { nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y' }] },
      treatment: 'x',
      outcome: 'y',
      data: { x: [0, 1], y: [0, 1] },
    });
    expect(r).toBeNull();
  });

  it('parses a well-formed ATE response', async () => {
    const port = stubSidecar(() => ({
      ok: true,
      result: {
        ate: 1.23,
        ci_low: 0.5,
        ci_high: 1.96,
        se: 0.37,
        n: 250,
        identification: 'backdoor',
      },
    }));
    const r = await runDowhyAte(port, {
      graph: { nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y' }] },
      treatment: 'x',
      outcome: 'y',
      data: { x: [0, 1], y: [0, 1] },
    });
    expect(r?.estimate).toBeCloseTo(1.23, 9);
    expect(r?.ciLow).toBeCloseTo(0.5, 9);
    expect(r?.ciHigh).toBeCloseTo(1.96, 9);
    expect(r?.identification).toBe('backdoor');
    expect(r?.sampleSize).toBe(250);
  });

  it('throws UNKNOWN_NODE when treatment is missing from graph', async () => {
    const port = stubSidecar(() => ({ ok: true, result: {} }));
    await expect(
      runDowhyAte(port, {
        graph: { nodes: ['y'], edges: [] },
        treatment: 'x',
        outcome: 'y',
        data: { x: [0, 1], y: [0, 1] },
      }),
    ).rejects.toBeInstanceOf(CausalInferenceError);
  });
});
