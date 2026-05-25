/**
 * Self-RAG reflection — unit tests.
 *
 * Coverage:
 *   1. parses "REL=high SUP=low USE=partial" from judge output
 *   2. unknown tokens default to 'unknown'
 *   3. financial claim + IsSUP=low → blocked=true
 *   4. financial claim + IsSUP=high → blocked=false
 *   5. NO financial claim + IsSUP=low → blocked=false (still unsafe but
 *      not the blocker's job to refuse)
 *   6. judge throwing returns unknown tokens, blocked=false
 *   7. no judge wired → unknown verdict, no throw
 *   8. containsFinancialClaim catches TZS, KES, $, "rent of N", clause refs
 */

import { describe, it, expect, vi } from 'vitest';
import {
  containsFinancialClaim,
  runSelfRag,
  type SelfRagJudge,
} from '../self-rag.js';

describe('containsFinancialClaim', () => {
  it('detects TZS / KES / USD amounts', () => {
    expect(containsFinancialClaim('Your rent is TZS 450,000 / month')).toBe(
      true,
    );
    expect(containsFinancialClaim('Pay KES 12,000 by Friday')).toBe(true);
    expect(containsFinancialClaim('$1,200 deposit is required')).toBe(true);
  });

  it('detects "rent of N" / "fee of N"', () => {
    expect(containsFinancialClaim('a rent of 450000 applies')).toBe(true);
    expect(containsFinancialClaim('a fee of 5000 is charged')).toBe(true);
  });

  it('detects lease/clause references with a section number', () => {
    expect(containsFinancialClaim('per lease clause 4.2')).toBe(true);
    expect(containsFinancialClaim('according to the lease')).toBe(true);
  });

  it('returns false for chit-chat', () => {
    expect(containsFinancialClaim('thanks!')).toBe(false);
    expect(containsFinancialClaim('the weather is nice today')).toBe(false);
  });
});

describe('runSelfRag — parsing', () => {
  it('parses REL/SUP/USE tokens from the judge rationale', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.8,
      reasonText:
        'REL=high SUP=high USE=partial\nLooks well-grounded but slightly verbose.',
    });
    const out = await runSelfRag({
      userMessage: 'what is the weather?',
      responseText: 'It is sunny.',
      judge,
    });
    expect(out.isRel).toBe('high');
    expect(out.isSup).toBe('high');
    expect(out.isUse).toBe('partial');
    expect(out.blocked).toBe(false);
  });

  it('keeps tokens at "unknown" when the judge rationale is empty', async () => {
    const judge: SelfRagJudge = vi
      .fn()
      .mockResolvedValue({ score: 0.5, reasonText: '' });
    const out = await runSelfRag({
      userMessage: 'hi',
      responseText: 'hello',
      judge,
    });
    expect(out.isRel).toBe('unknown');
    expect(out.isSup).toBe('unknown');
    expect(out.isUse).toBe('unknown');
  });

  it('accepts case-insensitive tokens', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.5,
      reasonText: 'rel=HIGH sup=Low use=partial',
    });
    const out = await runSelfRag({
      userMessage: 'x',
      responseText: 'y',
      judge,
    });
    expect(out.isRel).toBe('high');
    expect(out.isSup).toBe('low');
  });
});

describe('runSelfRag — blocking', () => {
  it('blocks when a financial claim is present AND IsSUP=low', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.2,
      reasonText:
        'REL=high SUP=low USE=high\nThe TZS figure is not in the retrieved context.',
    });
    const out = await runSelfRag({
      userMessage: 'what is my rent?',
      responseText: 'Your rent is TZS 450,000 / month',
      judge,
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toMatch(/financial/i);
  });

  it('does NOT block when IsSUP=high on a financial claim', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.9,
      reasonText: 'REL=high SUP=high USE=high\nGrounded in lease #L-42.',
    });
    const out = await runSelfRag({
      userMessage: 'what is my rent?',
      responseText: 'Your rent is TZS 450,000 / month',
      judge,
    });
    expect(out.blocked).toBe(false);
  });

  it('does NOT block when no financial claim is present even with low SUP', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.3,
      reasonText: 'REL=high SUP=low USE=partial\nVague answer',
    });
    const out = await runSelfRag({
      userMessage: 'how are you?',
      responseText: 'Just here.',
      judge,
    });
    expect(out.blocked).toBe(false);
  });

  it('blocks on IsSUP=unknown + financial claim (defensive)', async () => {
    const judge: SelfRagJudge = vi.fn().mockResolvedValue({
      score: 0.4,
      // No tokens parseable; SUP defaults to unknown
      reasonText: 'cannot tell',
    });
    const out = await runSelfRag({
      userMessage: 'what is the deposit?',
      responseText: 'Deposit of 600,000 applies.',
      judge,
    });
    expect(out.isSup).toBe('unknown');
    expect(out.blocked).toBe(true);
  });
});

describe('runSelfRag — failure modes', () => {
  it('returns unknown / not blocked when the judge throws (dev/test env)', async () => {
    const judge: SelfRagJudge = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await runSelfRag({
      userMessage: 'hi',
      responseText: 'rent is TZS 1000',
      judge,
      nodeEnv: 'test',
    });
    expect(out.isSup).toBe('unknown');
    expect(out.blocked).toBe(false);
    expect(out.rationale).toMatch(/judge-error/);
  });

  it('returns unknown when no judge wired', async () => {
    const out = await runSelfRag({
      userMessage: 'hi',
      responseText: 'hello',
      // @ts-expect-error — testing the runtime guard
      judge: undefined,
    });
    expect(out.isRel).toBe('unknown');
    expect(out.blocked).toBe(false);
  });
});

describe('runSelfRag — EP-3 CRITICAL #3 fail-closed', () => {
  it('blocks with judge_unavailable when judge throws AND stakes=high in production', async () => {
    const judge: SelfRagJudge = vi
      .fn()
      .mockRejectedValue(new Error('haiku timeout'));
    const out = await runSelfRag({
      userMessage: 'what is my rent?',
      responseText: 'TZS 450,000',
      judge,
      stakes: 'high',
      nodeEnv: 'production',
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('judge_unavailable');
    expect(out.rationale).toMatch(/judge-error/);
  });

  it('blocks with judge_unavailable when judge throws AND stakes=critical in production', async () => {
    const judge: SelfRagJudge = vi.fn().mockRejectedValue(new Error('500'));
    const out = await runSelfRag({
      userMessage: 'evict the tenant',
      responseText: 'eviction filed',
      judge,
      stakes: 'critical',
      nodeEnv: 'production',
    });
    expect(out.blocked).toBe(true);
    expect(out.blockedReason).toBe('judge_unavailable');
  });

  it('does NOT block when judge throws + stakes=low even in production (legacy fail-open)', async () => {
    const judge: SelfRagJudge = vi.fn().mockRejectedValue(new Error('500'));
    const out = await runSelfRag({
      userMessage: 'thanks',
      responseText: 'you are welcome',
      judge,
      stakes: 'low',
      nodeEnv: 'production',
    });
    expect(out.blocked).toBe(false);
  });

  it('does NOT block when judge throws in dev env even at stakes=critical', async () => {
    const judge: SelfRagJudge = vi.fn().mockRejectedValue(new Error('local'));
    const out = await runSelfRag({
      userMessage: 'evict',
      responseText: 'TZS 100,000',
      judge,
      stakes: 'critical',
      nodeEnv: 'development',
    });
    expect(out.blocked).toBe(false);
  });

  it('does NOT block when judge throws + stakes undefined (defensive: no stakes ⇒ no block)', async () => {
    const judge: SelfRagJudge = vi.fn().mockRejectedValue(new Error('e'));
    const out = await runSelfRag({
      userMessage: 'x',
      responseText: 'y',
      judge,
      nodeEnv: 'production',
    });
    expect(out.blocked).toBe(false);
  });
});
