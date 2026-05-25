import { describe, expect, it } from 'vitest';
import type { Label, Prediction, UncertainCase } from '../../types.js';
import { emptyModel, incorporateLabel, requestLabel } from '../label.js';
import { detectNoisyLabels, noisyLabelsToCases } from '../noise.js';

function makeCase(id: string, value: unknown, confidence = 0.4): UncertainCase {
  const pred: Prediction = { id, value, confidence, input: { hint: id } };
  return { id, prediction: pred, gap: 0.7 - confidence, reason: 'low_confidence' };
}

describe('requestLabel', () => {
  it('builds a LabelRequest with deterministic timestamp via injected now', () => {
    const c = makeCase('case-1', 'unknown');
    const req = requestLabel({
      case: c,
      oracle: 'human',
      now: () => new Date('2026-05-24T10:00:00Z'),
      note: 'look carefully',
    });
    expect(req.caseId).toBe('case-1');
    expect(req.oracle).toBe('human');
    expect(req.requestedAt).toBe('2026-05-24T10:00:00.000Z');
    expect(req.note).toBe('look carefully');
    expect(req.prediction.id).toBe('case-1');
  });

  it('omits note when not provided', () => {
    const req = requestLabel({
      case: makeCase('c2', 'x'),
      oracle: 'llm-jury',
      now: () => new Date('2026-05-24T10:00:00Z'),
    });
    expect(req.note).toBeUndefined();
  });
});

describe('incorporateLabel', () => {
  it('appends a label and bumps version + counts', () => {
    const m0 = emptyModel(10);
    const label: Label = {
      caseId: 'case-1',
      value: 'final',
      oracle: 'human',
      labeledAt: '2026-05-24T10:00:00Z',
    };
    const m1 = incorporateLabel({ label, model: m0 });
    expect(m1.version).toBe(1);
    expect(m1.labels).toHaveLength(1);
    expect(m1.labeledCases).toBe(1);
    expect(m1.totalCases).toBe(10);
    expect(m1.agreementRate).toBe(1);
  });

  it('keeps agreement high when oracles agree', () => {
    let m = emptyModel(0);
    m = incorporateLabel({
      label: {
        caseId: 'c1',
        value: 'yes',
        oracle: 'human',
        labeledAt: 't1',
      },
      model: m,
    });
    m = incorporateLabel({
      label: {
        caseId: 'c1',
        value: 'yes',
        oracle: 'llm-jury',
        labeledAt: 't2',
      },
      model: m,
    });
    expect(m.agreementRate).toBe(1);
    expect(m.labeledCases).toBe(1);
  });

  it('drops agreement when oracles disagree on the same case', () => {
    let m = emptyModel(0);
    m = incorporateLabel({
      label: { caseId: 'c1', value: 'yes', oracle: 'human', labeledAt: 't1' },
      model: m,
    });
    m = incorporateLabel({
      label: { caseId: 'c1', value: 'no', oracle: 'llm-jury', labeledAt: 't2' },
      model: m,
    });
    expect(m.agreementRate).toBe(0);
  });

  it('is pure — does not mutate the input model', () => {
    const m0 = emptyModel(5);
    const before = JSON.stringify(m0);
    incorporateLabel({
      label: { caseId: 'c1', value: 'v', oracle: 'human', labeledAt: 't' },
      model: m0,
    });
    expect(JSON.stringify(m0)).toBe(before);
  });
});

describe('detectNoisyLabels', () => {
  it('flags the minority value as noise', () => {
    const labels: Label[] = [
      { caseId: 'c1', value: 'yes', oracle: 'human', labeledAt: 't1' },
      { caseId: 'c1', value: 'yes', oracle: 'llm-jury', labeledAt: 't2' },
      { caseId: 'c1', value: 'no', oracle: 'llm-jury', labeledAt: 't3' },
    ];
    const noisy = detectNoisyLabels({ labels });
    expect(noisy).toHaveLength(1);
    expect(noisy[0]?.value).toBe('no');
  });

  it('ignores cases with only one label', () => {
    const labels: Label[] = [
      { caseId: 'c1', value: 'yes', oracle: 'human', labeledAt: 't1' },
    ];
    expect(detectNoisyLabels({ labels })).toHaveLength(0);
  });

  it('round-trips through noisyLabelsToCases', () => {
    const labels: Label[] = [
      { caseId: 'c1', value: 'a', oracle: 'human', labeledAt: 't1', oracleConfidence: 0.9 },
      { caseId: 'c1', value: 'a', oracle: 'llm-jury', labeledAt: 't2' },
      { caseId: 'c1', value: 'b', oracle: 'llm-jury', labeledAt: 't3', oracleConfidence: 0.3 },
    ];
    const noisy = detectNoisyLabels({ labels });
    const cases = noisyLabelsToCases(noisy);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.reason).toBe('noisy_label');
  });
});
