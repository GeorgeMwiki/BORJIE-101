import { describe, expect, it } from 'vitest';
import type { FairnessRow } from '../../types.js';
import {
  countByGroup,
  falseDiscoveryRate,
  falseOmissionRate,
  falsePositiveRate,
  positivePredictiveValue,
  selectionRate,
  truePositiveRate,
} from '../helpers.js';

describe('countByGroup', () => {
  it('produces confusion counts per group', () => {
    const rows: FairnessRow[] = [
      { group: 'F', prediction: 1, label: 1 },
      { group: 'F', prediction: 1, label: 0 },
      { group: 'F', prediction: 0, label: 1 },
      { group: 'F', prediction: 0, label: 0 },
      { group: 'M', prediction: 1, label: 1 },
      { group: 'M', prediction: 0, label: 0 },
    ];
    const c = countByGroup(rows);
    expect(c.F!.n).toBe(4);
    expect(c.F!.tp).toBe(1);
    expect(c.F!.fp).toBe(1);
    expect(c.F!.tn).toBe(1);
    expect(c.F!.fn).toBe(1);
    expect(c.M!.tp).toBe(1);
    expect(c.M!.tn).toBe(1);
    expect(c.M!.hasLabels).toBe(true);
  });

  it('flags hasLabels=false when any label missing', () => {
    const rows: FairnessRow[] = [
      { group: 'F', prediction: 1 },
      { group: 'F', prediction: 0 },
    ];
    const c = countByGroup(rows);
    expect(c.F!.hasLabels).toBe(false);
  });
});

describe('helpers — selection / TPR / FPR / PPV / FDR / FOR', () => {
  const counts = {
    n: 10,
    predPos: 6,
    predNeg: 4,
    tp: 4,
    fp: 2,
    tn: 3,
    fn: 1,
    actualPos: 5,
    actualNeg: 5,
    hasLabels: true,
  };

  it('selectionRate', () => {
    expect(selectionRate(counts)).toBe(0.6);
  });

  it('truePositiveRate', () => {
    expect(truePositiveRate(counts)).toBe(0.8);
  });

  it('falsePositiveRate', () => {
    expect(falsePositiveRate(counts)).toBe(0.4);
  });

  it('positivePredictiveValue', () => {
    expect(positivePredictiveValue(counts)).toBeCloseTo(4 / 6, 5);
  });

  it('falseDiscoveryRate', () => {
    expect(falseDiscoveryRate(counts)).toBeCloseTo(2 / 6, 5);
  });

  it('falseOmissionRate', () => {
    expect(falseOmissionRate(counts)).toBeCloseTo(1 / 4, 5);
  });

  it('handles degenerate empty group', () => {
    const empty = {
      n: 0,
      predPos: 0,
      predNeg: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
      actualPos: 0,
      actualNeg: 0,
      hasLabels: true,
    };
    expect(selectionRate(empty)).toBe(0);
    expect(truePositiveRate(empty)).toBe(0);
    expect(positivePredictiveValue(empty)).toBe(0);
  });
});
