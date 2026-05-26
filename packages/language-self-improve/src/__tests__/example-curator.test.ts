import { describe, expect, it } from 'vitest';

import {
  curateExamples,
  type CuratorInput,
  type PiiRedactorPort,
} from '../curate/example-curator.js';
import type { TrainingPair } from '../types.js';

function pair(
  id: string,
  source: string,
  target: string,
  aggregate: number,
): TrainingPair {
  return Object.freeze({
    id,
    tenantId: 't1',
    sourceText: source,
    targetText: target,
    lang: 'sw',
    utteranceId: null,
    scores: Object.freeze({
      wer: 0.05,
      per: 0.05,
      grammar: 0.9,
      terminology: 0.9,
      aggregate,
      recipientConsent: 'per-user-learn' as const,
    }),
    included: true,
    exclusionReason: null,
    recordedAt: '2026-05-26T10:00:00Z',
    auditHash: 'h',
    prevHash: 'p',
  });
}

const NULL_REDACTOR: PiiRedactorPort = {
  async redact(text: string, _tenantId: string): Promise<string> {
    return text.replace(/\b\d{9,}\b/g, '[REDACTED]');
  },
};

describe('example-curator', () => {
  it('deduplicates identical pairs', async () => {
    const inputs: CuratorInput[] = [
      { pair: pair('a', 'same source', 'same target', 0.9), dialect: 'bongo' },
      { pair: pair('b', 'same source', 'same target', 0.9), dialect: 'bongo' },
      { pair: pair('c', 'other source', 'other target', 0.9), dialect: 'bongo' },
    ];
    const result = await curateExamples(inputs, NULL_REDACTOR);
    // Two unique pairs after dedupe.
    expect(result.curated).toHaveLength(2);
  });

  it('balances dialects (no dialect over 50% of curated)', async () => {
    const inputs: CuratorInput[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        pair: pair(`bg-${i}`, `src ${i}`, `tgt ${i}`, 0.9),
        dialect: 'bongo' as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        pair: pair(`lk-${i}`, `lk-src ${i}`, `lk-tgt ${i}`, 0.9),
        dialect: 'lake' as const,
      })),
    ];
    const result = await curateExamples(inputs, NULL_REDACTOR);
    const includedDialects = result.curated
      .filter((p) => p.included)
      .map((p) => p.id);
    // Bongo had 10 entries, total = 12; max allowed = floor(12 * 0.5) = 6.
    // So 6 bongo + 2 lake should be included, 4 bongo dropped.
    const bongoIncluded = includedDialects.filter((id) => id.startsWith('bg-')).length;
    const lakeIncluded = includedDialects.filter((id) => id.startsWith('lk-')).length;
    expect(bongoIncluded).toBeLessThanOrEqual(6);
    expect(lakeIncluded).toBe(2);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('PII redactor strips digit sequences before persistence', async () => {
    const inputs: CuratorInput[] = [
      {
        pair: pair(
          'pii-1',
          'my number is 0712345678',
          'my number is 0712345678',
          0.9,
        ),
        dialect: 'bongo',
      },
    ];
    const result = await curateExamples(inputs, NULL_REDACTOR);
    expect(result.curated[0]?.sourceText).toContain('[REDACTED]');
    expect(result.curated[0]?.sourceText).not.toContain('0712345678');
  });
});
