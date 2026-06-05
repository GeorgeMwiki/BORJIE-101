import { describe, it, expect } from 'vitest';
import { buildFactBag, buildFactBags } from './fact-bag-builder.js';
import {
  calibrate,
  applyPlatt,
  sigmoid,
  temperatureScaledPlatt,
  expectedCalibrationError,
  DEFAULT_CALIBRATION_TABLE,
  DEFAULT_PLATT,
} from './calibration.js';
import { voteOnFields } from './self-consistency.js';

describe('buildFactBag', () => {
  it('projects identity fields and strips non-digits from ids', () => {
    const bag = buildFactBag({
      documentId: 'd1',
      docType: 'nida',
      fields: [
        { field_name: 'full_name', value: 'Juma Mwita Kessy', confidence: 95 },
        { field_name: 'national_id_number', value: '1990-0510-1111-2222', confidence: 88 },
        { field_name: 'phone', value: '0712345678', confidence: 70 },
      ],
    });
    expect(bag).toBeDefined();
    expect(bag?.primaryName?.full).toBe('JUMA MWITA KESSY');
    expect(bag?.nationalId).toBe('1990051011112222');
    expect(bag?.phones).toContain('0712345678');
    expect(bag?.fieldConfidences.primaryName).toBeCloseTo(0.95);
  });

  it('returns undefined when no comparable facts exist', () => {
    const bag = buildFactBag({
      documentId: 'd2',
      docType: 'other',
      fields: [{ field_name: 'random_note', value: 'hello', confidence: 50 }],
    });
    expect(bag).toBeUndefined();
  });

  it('captures a monetary amount from a royalty receipt', () => {
    const bag = buildFactBag({
      documentId: 'd3',
      docType: 'royalty-receipt',
      fields: [{ field_name: 'royalty_amount', value: 'TZS 1,200,000', confidence: 90 }],
    });
    expect(bag?.amount).toBe(1200000);
  });

  it('buildFactBags drops empty docs', () => {
    const bags = buildFactBags([
      { documentId: 'd1', docType: 'nida', fields: [{ field_name: 'name', value: 'Juma Kessy', confidence: 90 }] },
      { documentId: 'd2', docType: 'other', fields: [{ field_name: 'x', value: 'y', confidence: 10 }] },
    ]);
    expect(bags).toHaveLength(1);
  });
});

describe('calibration (Platt)', () => {
  it('sigmoid is monotonic and bounded', () => {
    expect(sigmoid(-100)).toBeCloseTo(0);
    expect(sigmoid(100)).toBeCloseTo(1);
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });

  it('applyPlatt stays within [0,1]', () => {
    expect(applyPlatt(2, DEFAULT_PLATT)).toBeLessThanOrEqual(1);
    expect(applyPlatt(-2, DEFAULT_PLATT)).toBeGreaterThanOrEqual(0);
  });

  it('uplifts structured ids vs free-text at the same raw score', () => {
    const raw = 0.7;
    const idScore = calibrate(raw, 'national_id_number', DEFAULT_CALIBRATION_TABLE);
    const textScore = calibrate(raw, 'free_text', DEFAULT_CALIBRATION_TABLE);
    expect(idScore).toBeGreaterThan(textScore);
  });

  it('falls back to the default curve for an unknown field type', () => {
    expect(calibrate(0.6, 'totally_unknown_field')).toBeCloseTo(applyPlatt(0.6, DEFAULT_PLATT));
  });

  it('temperatureScaledPlatt lowers ECE on a separable set', () => {
    // Build a set where high raw scores are mostly correct, low mostly wrong,
    // but the raw scores are over-confident (poorly calibrated).
    const samples = [
      ...Array.from({ length: 20 }, () => ({ rawScore: 0.95, correct: Math.random() < 0.6 })),
      ...Array.from({ length: 20 }, () => ({ rawScore: 0.05, correct: Math.random() < 0.4 })),
    ];
    const rawEce = expectedCalibrationError(samples.map((s) => s.rawScore), samples.map((s) => s.correct));
    const fit = temperatureScaledPlatt(samples);
    expect(fit.ece).toBeLessThanOrEqual(rawEce + 0.05);
    expect(fit.calibrated).toHaveLength(samples.length);
  });

  it('handles an empty held-out set', () => {
    const fit = temperatureScaledPlatt([]);
    expect(fit.calibrated).toHaveLength(0);
    expect(fit.ece).toBe(0);
  });
});

describe('self-consistency vote', () => {
  it('picks the majority value and reports agreement', () => {
    const result = voteOnFields([
      [{ field_name: 'tin', value: '123456789', confidence: 80 }],
      [{ field_name: 'tin', value: '123456789', confidence: 82 }],
      [{ field_name: 'tin', value: '123456780', confidence: 60 }],
    ]);
    const tin = result.merged.find((f) => f.field_name === 'tin');
    expect(tin?.value).toBe('123456789');
    const vote = result.votes.find((v) => v.fieldName === 'tin');
    expect(vote?.agreement).toBeCloseTo(2 / 3);
  });

  it('flags disagreement when shots split evenly', () => {
    const result = voteOnFields([
      [{ field_name: 'name', value: 'A', confidence: 70 }],
      [{ field_name: 'name', value: 'B', confidence: 70 }],
    ]);
    const vote = result.votes.find((v) => v.fieldName === 'name');
    expect(vote?.flaggedDisagreement).toBe(true);
    expect(vote?.distinctValues).toBe(2);
  });

  it('returns empty for no shots', () => {
    expect(voteOnFields([]).merged).toHaveLength(0);
  });

  it('treats key-reordered nested objects as the SAME value (canonical hash)', () => {
    // Two shots extract a structurally identical nested address, but the keys
    // are in a different order (and nested differently). The canonical
    // stringify must collapse them to one value — the old replacer-based key
    // misuse produced two distinct buckets and a spurious disagreement.
    const shotA = [
      {
        field_name: 'address',
        value: { region: 'Geita', detail: { poBox: '123', street: 'Main' } },
        confidence: 90,
      },
    ];
    const shotB = [
      {
        field_name: 'address',
        value: { detail: { street: 'Main', poBox: '123' }, region: 'Geita' },
        confidence: 88,
      },
    ];
    const result = voteOnFields([shotA, shotB]);
    const vote = result.votes.find((v) => v.fieldName === 'address');
    expect(vote?.distinctValues).toBe(1);
    expect(vote?.agreement).toBe(1);
    expect(vote?.flaggedDisagreement).toBe(false);
  });
});
