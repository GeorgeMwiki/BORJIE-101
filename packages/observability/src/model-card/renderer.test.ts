/**
 * Tests for the Mitchell et al. 2019 model-card renderer (LP-22b).
 */

import { describe, it, expect } from 'vitest';
import {
  renderModelCard,
  renderModelCardFromUnknown,
} from './renderer.js';
import { modelCardRecordSchema, type ModelCardRecord } from './types.js';

const BASE: ModelCardRecord = modelCardRecordSchema.parse({
  id: 'mdl_ore_grade_v1',
  name: 'Mr. Mwikila ore-grade estimator',
  version: '1.0.0',
  owner: 'Brain Engineering',
  trainedAt: '2026-05-01',
  trainDatasetHash: 'sha256:abc123',
  status: 'champion',
  intendedUse:
    'Advise on expected ore grade for a pit block from assay history; ' +
    'output is advisory and never the sole basis for an extraction decision.',
  outOfScopeUses: ['Licence eligibility', 'Royalty assessment'],
  features: [
    { name: 'assay_au_gpt', type: 'numeric', source: 'sensor:assay', nullable: false, sensitive: false },
    { name: 'pit_block_id', type: 'categorical', source: 'corpus:site', nullable: false, sensitive: false },
  ],
  metrics: [
    { key: 'rmse', value: 0.42, unit: 'g/t', higherIsBetter: false },
    { key: 'r2', value: 0.88 },
  ],
  fairnessSlices: [
    { attribute: 'region', slice: 'geita', metricValue: 0.9, population: 1200, disparityRatio: 1.0 },
    { attribute: 'region', slice: 'mwanza', metricValue: 0.82, population: 640, disparityRatio: 0.91 },
  ],
  trainingDataSummary: 'Assay history across 4 pilot estates, 2024-2026.',
  trainingSampleSize: 184232,
  ethicalConsiderations: ['Outputs append to rule-based decisions; never replace.'],
  caveats: ['Sparse assay coverage degrades accuracy on new blocks.'],
});

describe('renderModelCard — section structure', () => {
  it('renders all 8 Mitchell sections in order', () => {
    const { markdown } = renderModelCard(BASE);
    const sections = [
      '## 1. Model details',
      '## 2. Intended use',
      '## 3. Factors (features)',
      '## 4. Metrics',
      '## 5. Evaluation data — fairness slices',
      '## 6. Training data',
      '## 7. Ethical considerations',
      '## 8. Caveats & recommendations',
    ];
    let cursor = -1;
    for (const s of sections) {
      const idx = markdown.indexOf(s);
      expect(idx, `section present: ${s}`).toBeGreaterThan(-1);
      expect(idx, `section ordered: ${s}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('includes the model id, version, and advisory disclaimer', () => {
    const { markdown } = renderModelCard(BASE);
    expect(markdown).toContain('`mdl_ore_grade_v1`');
    expect(markdown).toContain('v1.0.0');
    expect(markdown).toContain('APPEND, never replace');
  });

  it('renders feature, metric, and fairness tables', () => {
    const { markdown } = renderModelCard(BASE);
    expect(markdown).toContain('| assay_au_gpt | numeric | sensor:assay | no | no |');
    expect(markdown).toContain('| rmse | 0.4200 | g/t | lower |');
    expect(markdown).toContain('| region | geita |');
  });
});

describe('renderModelCard — fairness gate (four-fifths analog)', () => {
  it('passes when every slice meets the floor', () => {
    const res = renderModelCard(BASE);
    expect(res.fairnessPasses).toBe(true);
    expect(res.failingSlices).toHaveLength(0);
    expect(res.markdown).toContain('| region | mwanza | 0.8200 | 640 | 0.9100 | PASS |');
  });

  it('fails and lists the slice below the floor', () => {
    const record: ModelCardRecord = {
      ...BASE,
      fairnessSlices: [
        ...BASE.fairnessSlices,
        { attribute: 'language', slice: 'swahili', metricValue: 0.6, population: 900, disparityRatio: 0.7 },
      ],
    };
    const res = renderModelCard(record);
    expect(res.fairnessPasses).toBe(false);
    expect(res.failingSlices).toHaveLength(1);
    expect(res.failingSlices[0]?.slice).toBe('swahili');
    expect(res.markdown).toContain('FAIL');
  });

  it('honours a custom fairness floor', () => {
    const strict: ModelCardRecord = { ...BASE, fairnessFloor: 0.95 };
    const res = renderModelCard(strict);
    // mwanza @ 0.91 now fails the stricter 0.95 floor.
    expect(res.fairnessPasses).toBe(false);
    expect(res.failingSlices.map((s) => s.slice)).toContain('mwanza');
  });
});

describe('renderModelCard — determinism + safety', () => {
  it('is byte-identical across renders (no hidden clock/env)', () => {
    const a = renderModelCard(BASE).markdown;
    const b = renderModelCard(BASE).markdown;
    expect(a).toBe(b);
  });

  it('only appends a footer stamp when generatedAt is supplied', () => {
    expect(renderModelCard(BASE).markdown).not.toContain('generated ');
    const stamped = renderModelCard(BASE, { generatedAt: '2026-06-03T00:00:00Z' });
    expect(stamped.markdown).toContain('generated 2026-06-03T00:00:00Z');
  });

  it('escapes pipe characters in cell content', () => {
    const record: ModelCardRecord = {
      ...BASE,
      features: [
        { name: 'a|b', type: 'text', source: 'x|y', nullable: false, sensitive: true },
      ],
    };
    const { markdown } = renderModelCard(record);
    expect(markdown).toContain('a\\|b');
    expect(markdown).toContain('x\\|y');
  });

  it('handles empty optional sections gracefully', () => {
    const sparse = modelCardRecordSchema.parse({
      id: 'm',
      name: 'm',
      version: '0',
      owner: 'o',
      trainedAt: '2026-01-01',
      trainDatasetHash: 'sha256:0',
      status: 'shadow',
      intendedUse: 'use',
      trainingDataSummary: 'data',
      trainingSampleSize: 0,
    });
    const { markdown, fairnessPasses } = renderModelCard(sparse);
    expect(markdown).toContain('_No features declared._');
    expect(markdown).toContain('_No metrics reported._');
    expect(markdown).toContain('_No disaggregated slices reported._');
    expect(fairnessPasses).toBe(true);
  });
});

describe('renderModelCardFromUnknown — validation', () => {
  it('renders a valid plain object', () => {
    const res = renderModelCardFromUnknown({ ...BASE });
    expect(res.markdown).toContain('## 1. Model details');
  });

  it('throws on a malformed record (fail closed)', () => {
    expect(() => renderModelCardFromUnknown({ id: 'x' })).toThrow();
  });
});
