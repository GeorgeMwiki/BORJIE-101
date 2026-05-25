/**
 * Data-grounding unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  substitute,
  groundWorkedExample,
  StubTutoringDataAdapter,
  BUILT_IN_CONCEPTS,
} from '../index.js';

describe('substitute', () => {
  it('replaces simple placeholders', () => {
    expect(substitute('Hello {{name}}', { name: 'World' })).toBe(
      'Hello World',
    );
  });

  it('keeps unresolved placeholders visible', () => {
    expect(substitute('A {{x}} B', {})).toBe('A [x] B');
  });

  it('formats numbers with thousands separators', () => {
    expect(substitute('{{n}}', { n: 1234567 })).toBe('1,234,567');
  });

  it('handles undefined and null values', () => {
    expect(substitute('{{a}} {{b}}', { a: null, b: undefined })).toBe(
      '[a] [b]',
    );
  });
});

describe('groundWorkedExample', () => {
  it('returns static text when no data binding', async () => {
    const concept = BUILT_IN_CONCEPTS['depreciation']!;
    const out = await groundWorkedExample({
      concept,
      tenantId: 't1',
      dataAdapter: new StubTutoringDataAdapter(),
    });
    expect(out.prompt).toBe(concept.content.worked_example.prompt);
    expect(out.citations).toHaveLength(0);
  });

  it('substitutes resolved values from the adapter', async () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    const adapter = new StubTutoringDataAdapter({
      'payments-ledger.tenant.month_summary': {
        values: {
          gross_income: 100000,
          op_ex: 35000,
          noi_expected: 65000,
          period_label: 'Sept 2025',
        },
        citations: [
          { key: 'gross_income', value: 100000, sourceRef: 'ledger:abc-123' },
        ],
      },
    });
    const out = await groundWorkedExample({
      concept,
      tenantId: 't1',
      dataAdapter: adapter,
    });
    expect(out.prompt).toMatch(/100,000/);
    expect(out.prompt).toMatch(/35,000/);
    expect(out.prompt).toMatch(/Sept 2025/);
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0]!.sourceRef).toBe('ledger:abc-123');
  });

  it('degrades gracefully when adapter throws', async () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    const broken = {
      resolve: () => Promise.reject(new Error('boom')),
    };
    const out = await groundWorkedExample({
      concept,
      tenantId: 't1',
      dataAdapter: broken,
    });
    // The placeholders stay visible — the lesson still teaches.
    expect(out.prompt).toMatch(/\[gross_income\]/);
    expect(out.citations).toHaveLength(0);
  });
});

describe('StubTutoringDataAdapter', () => {
  it('returns empty values + citations for unknown source', async () => {
    const adapter = new StubTutoringDataAdapter();
    const r = await adapter.resolve({
      tenantId: 't1',
      binding: {
        source: 'no.such.source',
        inputs: {},
        placeholders: {},
      },
    });
    expect(r.values).toEqual({});
    expect(r.citations).toHaveLength(0);
  });
});
