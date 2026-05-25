import { describe, expect, it } from 'vitest';
import {
  appendTurn,
  compressOnce,
  emptySummaryState,
  needsCompression,
  planCompression,
  type ChatTurn,
  type ConversationalSummaryConfig,
  type SummarizerPort,
} from '../conversational-summary.js';

const turn = (content: string, tokens = 10, tsMs = 0): ChatTurn => ({
  role: 'user',
  content,
  tokens,
  tsMs,
});

const cfg: ConversationalSummaryConfig = {
  tailBudgetTokens: 50,
  minTailTokens: 20,
  compressionTriggerTokens: 60,
};

describe('conversational-summary', () => {
  it('emptySummaryState yields zero counters', () => {
    const s = emptySummaryState();
    expect(s.summary).toBe('');
    expect(s.summaryTokens).toBe(0);
    expect(s.tail.length).toBe(0);
  });

  it('appendTurn does not mutate the original', () => {
    const s = emptySummaryState();
    const next = appendTurn(s, turn('hi'));
    expect(s.tail.length).toBe(0);
    expect(next.tail.length).toBe(1);
  });

  it('needsCompression is false when under trigger', () => {
    const s = appendTurn(emptySummaryState(), turn('hi', 5));
    expect(needsCompression(s, cfg)).toBe(false);
  });

  it('needsCompression is true when total exceeds trigger', () => {
    let s = emptySummaryState();
    for (let i = 0; i < 8; i++) s = appendTurn(s, turn(`m${i}`, 10));
    expect(needsCompression(s, cfg)).toBe(true);
  });

  it('planCompression keeps at least minTailTokens live', () => {
    const tail = Array.from({ length: 10 }, (_, i) => turn(`m${i}`, 10, i));
    const plan = planCompression(tail, 20);
    const liveTokens = plan.keepLive.reduce((s, t) => s + t.tokens, 0);
    expect(liveTokens).toBeGreaterThanOrEqual(20);
    expect(plan.toSummarize.length + plan.keepLive.length).toBe(10);
  });

  it('planCompression preserves recency ordering', () => {
    const tail = Array.from({ length: 5 }, (_, i) => turn(`m${i}`, 10, i));
    const plan = planCompression(tail, 20);
    if (plan.keepLive.length > 0) {
      const last = tail[tail.length - 1];
      const liveLast = plan.keepLive[plan.keepLive.length - 1];
      expect(liveLast?.content).toBe(last?.content);
    }
  });

  it('planCompression with tiny tail returns empty toSummarize', () => {
    const plan = planCompression([turn('only', 5, 0)], 20);
    expect(plan.toSummarize.length).toBe(0);
    expect(plan.keepLive.length).toBe(1);
  });

  it('compressOnce no-ops when under trigger', async () => {
    const s = appendTurn(emptySummaryState(), turn('hi', 5));
    const summarizer: SummarizerPort = {
      summarize: async () => ({ summary: 'should not run', tokens: 100 }),
    };
    const out = await compressOnce(s, cfg, summarizer);
    expect(out.state).toBe(s);
  });

  it('compressOnce folds older turns into summary', async () => {
    let s = emptySummaryState();
    for (let i = 0; i < 8; i++) s = appendTurn(s, turn(`m${i}`, 10, i));
    const summarizer: SummarizerPort = {
      summarize: async (turns) => ({
        summary: `sum-of-${turns.length}`,
        tokens: 15,
      }),
    };
    const out = await compressOnce(s, cfg, summarizer);
    expect(out.state.summary.startsWith('sum-of')).toBe(true);
    expect(out.state.summaryTokens).toBe(15);
    expect(out.state.tail.length).toBeLessThan(s.tail.length);
  });

  it('compressOnce seeds prior summary so it monotonically improves', async () => {
    let s = emptySummaryState();
    for (let i = 0; i < 8; i++) s = appendTurn(s, turn(`m${i}`, 10, i));
    const first: SummarizerPort = {
      summarize: async () => ({ summary: 'A', tokens: 10 }),
    };
    const after1 = await compressOnce(s, cfg, first);
    for (let i = 0; i < 8; i++) {
      after1.state.tail; // touch to keep order
    }
    let s2 = after1.state;
    for (let i = 0; i < 8; i++) s2 = appendTurn(s2, turn(`n${i}`, 10, 100 + i));
    let seenSeed = false;
    const second: SummarizerPort = {
      summarize: async (turns) => {
        if (turns.some((t) => t.content.includes('Prior summary: A'))) seenSeed = true;
        return { summary: 'B', tokens: 10 };
      },
    };
    await compressOnce(s2, cfg, second);
    expect(seenSeed).toBe(true);
  });

  it('compressOnce flags when summary does not fit budget', async () => {
    let s = emptySummaryState();
    for (let i = 0; i < 8; i++) s = appendTurn(s, turn(`m${i}`, 10, i));
    const fat: SummarizerPort = {
      summarize: async () => ({ summary: 'huge', tokens: 999 }),
    };
    const out = await compressOnce(s, cfg, fat);
    expect(out.summaryFitsBudget).toBe(false);
  });
});
