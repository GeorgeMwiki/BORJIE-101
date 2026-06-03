import { describe, expect, it, vi } from 'vitest';
import {
  extractPrimaryClaim,
  compareClaims,
  shouldSampleForAudit,
  sampleRateForIntent,
  auditResponse,
  type AuditableResponse,
  type ProviderAuditEvent,
  type SecondOpinionPort,
} from '../index.js';

describe('extractPrimaryClaim', () => {
  it('extracts a monetary figure with an ISO currency token (currency-neutral)', () => {
    const c = extractPrimaryClaim('The royalty due is TZS 1,250,000 this quarter');
    expect(c?.numeric).toBe(1_250_000);
    expect(c?.unit).toBe('TZS');
  });

  it('extracts a different currency the same way (no currency hard-coded)', () => {
    const c = extractPrimaryClaim('Estimated at USD 4.5 million');
    expect(c?.numeric).toBe(4_500_000);
    expect(c?.unit).toBe('USD');
  });

  it('applies magnitude suffixes', () => {
    expect(extractPrimaryClaim('NGN 3 billion')?.numeric).toBe(3_000_000_000);
    expect(extractPrimaryClaim('KES 12k')?.numeric).toBe(12_000);
  });

  it('extracts a percentage', () => {
    const c = extractPrimaryClaim('The grade is 6.5% Cu');
    expect(c?.numeric).toBe(6.5);
    expect(c?.unit).toBe('percent');
  });

  it('returns null for prose with no numeric claim', () => {
    expect(extractPrimaryClaim('The licence is in good standing.')).toBeNull();
    expect(extractPrimaryClaim('')).toBeNull();
    expect(extractPrimaryClaim(null)).toBeNull();
  });
});

describe('compareClaims', () => {
  const claim = (numeric: number | null, unit: string | null, text = String(numeric)) => ({
    text,
    numeric,
    unit,
  });

  it('agrees when both numeric values are within tolerance', () => {
    const r = compareClaims(claim(100, 'TZS'), claim(102, 'TZS'), 0.05);
    expect(r.diverged).toBe(false);
    expect(r.agreement).toBeGreaterThan(0.95);
  });

  it('flags numeric_mismatch beyond tolerance', () => {
    const r = compareClaims(claim(100, 'TZS'), claim(150, 'TZS'), 0.05);
    expect(r.diverged).toBe(true);
    expect(r.kind).toBe('numeric_mismatch');
  });

  it('flags one_missing when only one side has a claim', () => {
    const r = compareClaims(claim(100, 'TZS'), null, 0.05);
    expect(r.diverged).toBe(true);
    expect(r.kind).toBe('one_missing');
  });

  it('agrees when neither side made a claim', () => {
    const r = compareClaims(null, null, 0.05);
    expect(r.diverged).toBe(false);
    expect(r.agreement).toBe(1);
  });

  it('handles text-only (null numeric) comparison', () => {
    const r = compareClaims(claim(null, 'x', 'high'), claim(null, 'y', 'low'), 0.05);
    expect(r.diverged).toBe(true);
    expect(r.kind).toBe('contradictory');
  });
});

describe('sampling', () => {
  it('pins numeric/regulatory mining intents at 100%', () => {
    expect(sampleRateForIntent('royalty_query')).toBe(1);
    expect(sampleRateForIntent('grade_query')).toBe(1);
    expect(shouldSampleForAudit('pricing_query', { random: () => 0.99 })).toBe(true);
  });

  it('samples advisory intents at 25%', () => {
    expect(sampleRateForIntent('benchmark_query')).toBe(0.25);
    expect(shouldSampleForAudit('benchmark_query', { random: () => 0.1 })).toBe(true);
    expect(shouldSampleForAudit('benchmark_query', { random: () => 0.9 })).toBe(false);
  });

  it('never audits unknown intents unless treatUnknownAsDefault', () => {
    expect(shouldSampleForAudit('totally_unknown', { random: () => 0 })).toBe(false);
    expect(
      shouldSampleForAudit('totally_unknown', { treatUnknownAsDefault: true, random: () => 0.01 }),
    ).toBe(true);
  });

  it('forceNumeric overrides intent sampling', () => {
    expect(shouldSampleForAudit('chit_chat', { forceNumeric: true })).toBe(true);
  });
});

describe('auditResponse', () => {
  const primary = (text: string, provider = 'anthropic'): AuditableResponse => ({ provider, text });

  it('skips when sampling declines (no numeric claim, advisory intent, high RNG)', async () => {
    const secondOpinion = vi.fn<SecondOpinionPort>();
    const out = await auditResponse(
      { prompt: 'How is the weather on site?', intent: 'benchmark_query', primary: primary('Sunny.') },
      { secondOpinion, random: () => 0.99 },
    );
    expect(out.audited).toBe(false);
    expect(secondOpinion).not.toHaveBeenCalled();
  });

  it('forces an audit when the primary response carries a numeric claim', async () => {
    const secondOpinion = vi.fn<SecondOpinionPort>(async () => primary('Royalty is TZS 1,000,000', 'openai'));
    const out = await auditResponse(
      { prompt: 'royalty?', intent: 'chit_chat', primary: primary('Royalty is TZS 1,000,000') },
      { secondOpinion, random: () => 0.99 },
    );
    expect(out.audited).toBe(true);
    expect(secondOpinion).toHaveBeenCalledOnce();
    expect(out.diverged).toBe(false);
  });

  it('emits a divergence event via the sink when numeric values differ >5%', async () => {
    const events: ProviderAuditEvent[] = [];
    const secondOpinion: SecondOpinionPort = async () => primary('Royalty is TZS 2,000,000', 'openai');
    const out = await auditResponse(
      { prompt: 'royalty due?', intent: 'royalty_query', primary: primary('Royalty is TZS 1,000,000') },
      { secondOpinion, sink: (e) => void events.push(e) },
    );
    expect(out.diverged).toBe(true);
    expect(out.kind).toBe('numeric_mismatch');
    expect(events).toHaveLength(1);
    expect(events[0]!.numericA).toBe(1_000_000);
    expect(events[0]!.numericB).toBe(2_000_000);
    expect(events[0]!.providerB).toBe('openai');
  });

  it('does NOT emit when the two providers agree', async () => {
    const sink = vi.fn();
    const secondOpinion: SecondOpinionPort = async () => primary('Royalty is TZS 1,010,000', 'openai');
    const out = await auditResponse(
      { prompt: 'royalty?', intent: 'royalty_query', primary: primary('Royalty is TZS 1,000,000') },
      { secondOpinion, sink },
    );
    expect(out.diverged).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  it('never throws when the second-opinion provider fails', async () => {
    const secondOpinion: SecondOpinionPort = async () => {
      throw new Error('provider down');
    };
    const out = await auditResponse(
      { prompt: 'royalty?', intent: 'royalty_query', primary: primary('Royalty is TZS 1,000,000') },
      { secondOpinion },
    );
    expect(out.audited).toBe(false);
  });

  it('swallows a throwing sink', async () => {
    const secondOpinion: SecondOpinionPort = async () => primary('Royalty is TZS 5,000,000', 'openai');
    await expect(
      auditResponse(
        { prompt: 'royalty?', intent: 'royalty_query', primary: primary('Royalty is TZS 1,000,000') },
        {
          secondOpinion,
          sink: () => {
            throw new Error('sink boom');
          },
        },
      ),
    ).resolves.toMatchObject({ diverged: true });
  });
});
