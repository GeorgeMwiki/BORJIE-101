import { describe, expect, it } from 'vitest';
import { authorChartFromQuestion, pickTemplate, type ChartAuthorBrain } from '../ai-chart-author/index.js';
import { inferSchema } from '../parsers/index.js';
import type { NLQueryRequest } from '../types.js';

const sampleRows = [
  { signed_at: '2026-01-01T00:00:00Z', amount: 100, status: 'active' },
  { signed_at: '2026-02-01T00:00:00Z', amount: 200, status: 'cancelled' },
  { signed_at: '2026-03-01T00:00:00Z', amount: 150, status: 'active' },
];

const schema = inferSchema(sampleRows);

describe('ai-chart-author / pickTemplate', () => {
  it('picks line for trend questions when a time + numeric column exist', () => {
    const pick = pickTemplate('What is the trend over time?', schema);
    expect(pick.kind).toBe('line');
  });

  it('picks pie for share questions', () => {
    const pick = pickTemplate('What is the share by status?', schema);
    expect(pick.kind).toBe('arc');
  });

  it('picks boxplot for distribution questions', () => {
    const pick = pickTemplate('Show the distribution of amounts per status', schema);
    expect(pick.kind).toBe('boxplot');
  });

  it('picks scatter for correlate questions when two numerics exist', () => {
    const schema2 = inferSchema([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const pick = pickTemplate('correlate a and b', schema2);
    expect(pick.kind).toBe('point');
  });

  it('preferred chart wins if schema supports it', () => {
    const pick = pickTemplate('anything', schema, 'line');
    expect(pick.kind).toBe('line');
  });
});

describe('ai-chart-author / authorChartFromQuestion (deterministic)', () => {
  it('returns a deterministic line chart when no brain is supplied', async () => {
    const req: NLQueryRequest = { question: 'show the trend over time', schema };
    const res = await authorChartFromQuestion({ request: req, sampleData: sampleRows });
    expect(res.deterministic).toBe(true);
    const mark = res.spec.mark as Record<string, unknown>;
    expect(mark['type']).toBe('line');
  });

  it('returns a bar chart when no time column exists', async () => {
    const s = inferSchema([{ a: 'x', b: 1 }, { a: 'y', b: 2 }]);
    const res = await authorChartFromQuestion({ request: { question: 'compare a', schema: s } });
    expect(res.deterministic).toBe(true);
    expect((res.spec.mark as Record<string, unknown>)['type']).toBe('bar');
  });
});

describe('ai-chart-author / authorChartFromQuestion (with brain)', () => {
  it('uses the brain when it returns a valid spec', async () => {
    const brain: ChartAuthorBrain = {
      async completeJson() {
        return {
          content: JSON.stringify({
            spec: {
              data: { values: sampleRows },
              mark: 'point',
              encoding: { x: { field: 'amount', type: 'quantitative' }, y: { field: 'amount', type: 'quantitative' } },
            },
            sql: 'SELECT amount FROM leases',
            explanation: 'Scatter of amount',
          }),
        };
      },
    };
    const res = await authorChartFromQuestion({
      request: { question: 'whatever', schema },
      brain,
      sampleData: sampleRows,
    });
    expect(res.deterministic).toBe(false);
    expect(res.sql).toBe('SELECT amount FROM leases');
    expect(res.spec.mark).toBe('point');
  });

  it('falls back to deterministic when brain returns invalid JSON', async () => {
    const brain: ChartAuthorBrain = {
      async completeJson() {
        return { content: 'not json' };
      },
    };
    const res = await authorChartFromQuestion({
      request: { question: 'trend', schema },
      brain,
      sampleData: sampleRows,
    });
    expect(res.deterministic).toBe(true);
  });

  it('falls back when brain returns spec that fails validation', async () => {
    const brain: ChartAuthorBrain = {
      async completeJson() {
        return { content: JSON.stringify({ spec: { foo: 'bar' }, explanation: 'x' }) };
      },
    };
    const res = await authorChartFromQuestion({
      request: { question: 'trend', schema },
      brain,
      sampleData: sampleRows,
    });
    expect(res.deterministic).toBe(true);
  });

  it('falls back when brain throws', async () => {
    const brain: ChartAuthorBrain = {
      async completeJson() {
        throw new Error('rate limited');
      },
    };
    const res = await authorChartFromQuestion({
      request: { question: 'share by status', schema },
      brain,
      sampleData: sampleRows,
    });
    expect(res.deterministic).toBe(true);
  });

  it('injects sample data when brain spec omits data.values', async () => {
    const brain: ChartAuthorBrain = {
      async completeJson() {
        return {
          content: JSON.stringify({
            spec: {
              mark: 'bar',
              encoding: { x: { field: 'status' }, y: { field: 'amount' } },
            },
            explanation: 'bar',
          }),
        };
      },
    };
    const res = await authorChartFromQuestion({
      request: { question: 'show', schema },
      brain,
      sampleData: sampleRows,
    });
    expect(res.deterministic).toBe(false);
    expect((res.spec.data as { values?: readonly unknown[] }).values).toEqual(sampleRows);
  });
});
