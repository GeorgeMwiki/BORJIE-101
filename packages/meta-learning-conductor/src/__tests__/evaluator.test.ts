import { describe, expect, it } from 'vitest';
import {
  EvaluatorError,
  runBeforeAfterEval,
} from '../evaluator/evaluator.js';
import type { EvaluatorPort } from '../types.js';

function stubEval(
  before: number,
  after: number,
): EvaluatorPort {
  return Object.freeze({
    score: async ({ side }) => (side === 'before' ? before : after),
  });
}

describe('runBeforeAfterEval', () => {
  it('returns before + after metrics from the port', async () => {
    const out = await runBeforeAfterEval({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
      port: stubEval(0.6, 0.7),
    });
    expect(out.evalMetricBefore).toBe(0.6);
    expect(out.evalMetricAfter).toBe(0.7);
  });

  it('throws on NaN', async () => {
    const port: EvaluatorPort = {
      score: async () => Number.NaN,
    };
    await expect(
      runBeforeAfterEval({
        tenantId: 'tenant-a',
        capabilityId: 'cap-1',
        port,
      }),
    ).rejects.toThrowError(EvaluatorError);
  });

  it('throws when score is out of [0,1]', async () => {
    const port: EvaluatorPort = {
      score: async () => 1.5,
    };
    await expect(
      runBeforeAfterEval({
        tenantId: 'tenant-a',
        capabilityId: 'cap-1',
        port,
      }),
    ).rejects.toThrowError(EvaluatorError);
  });
});
