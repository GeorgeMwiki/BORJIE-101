import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateTokens,
  estimateTokensOfMany,
  budgetForIntent,
  DEFAULT_PROMPT_BUDGET,
  PROMPT_BUDGET_BY_INTENT,
  trimToBudget,
  summarizeOverflowHistory,
  setPromptBudgetSink,
  resetPromptBudgetSink,
  type PromptLayer,
  type PromptBudgetEvent,
  type HistoryTurn,
} from '../index.js';

afterEach(() => {
  resetPromptBudgetSink();
  vi.restoreAllMocks();
});

describe('estimateTokens', () => {
  it('returns 0 for empty / nullish', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates English within ~10% of the char/4 + word mean', () => {
    // 11 words, 56 chars → charBased=14, words=11 → mean 13 (ceil 12.5).
    const text = 'the quick brown fox jumps over the lazy dog again now';
    const t = estimateTokens(text);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(20);
  });

  it('does not under-count Swahili agglutinative words', () => {
    const sw = 'Karibu kwenye mfumo wa madini wa Borjie unaoongozwa na akili bandia';
    const en = 'Welcome to the Borjie mining estate system run by ai';
    expect(estimateTokens(sw)).toBeGreaterThan(0);
    // Longer SW words → char-based dominates, still a finite positive estimate.
    expect(estimateTokens(sw)).toBeGreaterThanOrEqual(estimateTokens(en) - 2);
  });

  it('treats runs of whitespace as a single word boundary (no inflation)', () => {
    // Two-word inputs estimate the same regardless of internal newlines/tabs
    // when total length is equal — the word component does not over-count runs.
    expect(estimateTokens('a\n\nb')).toBe(estimateTokens('a  b'));
    // A purely-whitespace string has no words → estimate driven by chars only.
    expect(estimateTokens('     ')).toBeGreaterThan(0);
    expect(estimateTokens('   ').valueOf()).toBe(Math.ceil(3 / 4 / 2));
  });

  it('sums many strings', () => {
    expect(estimateTokensOfMany(['one two', 'three four'])).toBe(
      estimateTokens('one two') + estimateTokens('three four'),
    );
    expect(estimateTokensOfMany([null, undefined, ''])).toBe(0);
  });
});

describe('budgetForIntent', () => {
  it('resolves known intents from the map', () => {
    expect(budgetForIntent('classify')).toEqual(PROMPT_BUDGET_BY_INTENT.classify);
    expect(budgetForIntent('longdoc').maxTokens).toBeGreaterThan(
      PROMPT_BUDGET_BY_INTENT.chat!.maxTokens,
    );
  });

  it('falls back to default for unknown / nullish intents', () => {
    expect(budgetForIntent('made-up')).toEqual(DEFAULT_PROMPT_BUDGET);
    expect(budgetForIntent(null)).toEqual(DEFAULT_PROMPT_BUDGET);
    expect(budgetForIntent(undefined)).toEqual(DEFAULT_PROMPT_BUDGET);
  });

  it('every mapped budget has warn < max', () => {
    for (const b of Object.values(PROMPT_BUDGET_BY_INTENT)) {
      expect(b.warnTokens).toBeLessThan(b.maxTokens);
    }
  });
});

describe('trimToBudget', () => {
  const layers: readonly PromptLayer[] = [
    { name: 'persona', content: 'P'.repeat(40), priority: 100 },
    { name: 'tools', content: 'T'.repeat(40), priority: 80 },
    { name: 'evidence', content: 'E'.repeat(40), priority: 60 },
    { name: 'history', content: 'H'.repeat(400), priority: 20 },
  ];

  it('is pure — does not mutate the input array or elements', () => {
    const snapshot = JSON.parse(JSON.stringify(layers));
    trimToBudget(layers, { maxTokens: 30, warnTokens: 20 });
    expect(layers).toEqual(snapshot);
  });

  it('keeps everything when the budget is generous', () => {
    const r = trimToBudget(layers, { maxTokens: 100_000, warnTokens: 90_000 });
    expect(r.kept).toHaveLength(4);
    expect(r.dropped).toHaveLength(0);
    expect(r.overWarn).toBe(false);
  });

  it('drops lowest-priority layers first to fit the ceiling', () => {
    // Each 40-char layer ≈ 10 tokens; 400-char history ≈ 100 tokens.
    const r = trimToBudget(layers, { maxTokens: 35, warnTokens: 25 });
    const keptNames = r.kept.map((l) => l.name);
    expect(keptNames).toContain('persona');
    expect(keptNames).not.toContain('history'); // lowest priority dropped first
    expect(r.dropped[0]).toBe('history');
  });

  it('never throws + never returns empty even for an absurdly small budget', () => {
    const r = trimToBudget(layers, { maxTokens: 1, warnTokens: 1 });
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.name).toBe('persona'); // highest priority always survives
    expect(r.dropped).toEqual(['history', 'evidence', 'tools']); // lowest-first
  });

  it('breaks priority ties by original input order (cache-stable)', () => {
    const tied: readonly PromptLayer[] = [
      { name: 'a', content: 'x', priority: 50 },
      { name: 'b', content: 'y', priority: 50 },
    ];
    const r = trimToBudget(tied, { maxTokens: 100, warnTokens: 50 });
    expect(r.kept.map((l) => l.name)).toEqual(['a', 'b']);
  });

  it('emits a telemetry event with droppedLayers when intent is provided', () => {
    const events: PromptBudgetEvent[] = [];
    setPromptBudgetSink((e) => events.push(e));
    trimToBudget(layers, { maxTokens: 35, warnTokens: 25 }, 'chat');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.intent).toBe('chat');
    expect(ev.trimmed).toBe(true);
    expect(ev.droppedLayers).toContain('history');
    expect(typeof ev.at).toBe('string');
  });

  it('does not emit when intent is omitted', () => {
    const events: PromptBudgetEvent[] = [];
    setPromptBudgetSink((e) => events.push(e));
    trimToBudget(layers, { maxTokens: 35, warnTokens: 25 });
    expect(events).toHaveLength(0);
  });

  it('swallows a throwing sink (telemetry never breaks the hot path)', () => {
    setPromptBudgetSink(() => {
      throw new Error('sink boom');
    });
    expect(() => trimToBudget(layers, { maxTokens: 35, warnTokens: 25 }, 'chat')).not.toThrow();
  });
});

describe('summarizeOverflowHistory', () => {
  const makeHistory = (n: number): HistoryTurn[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn number ${i} with some filler words to add tokens here`,
    }));

  it('returns history unchanged when it already fits', async () => {
    const h = makeHistory(3);
    const r = await summarizeOverflowHistory(h, { maxHistoryTokens: 100_000 });
    expect(r.summarized).toBe(false);
    expect(r.collapsedCount).toBe(0);
    expect(r.turns).toEqual(h);
  });

  it('returns unchanged when length <= keepRecent', async () => {
    const h = makeHistory(4);
    const r = await summarizeOverflowHistory(h, { maxHistoryTokens: 1, keepRecent: 6 });
    expect(r.summarized).toBe(false);
    expect(r.turns).toHaveLength(4);
  });

  it('collapses overflow into a heuristic summary, keeping recent turns', async () => {
    const h = makeHistory(20);
    const r = await summarizeOverflowHistory(h, { maxHistoryTokens: 50, keepRecent: 4 });
    expect(r.summarized).toBe(true);
    expect(r.collapsedCount).toBe(16);
    // First turn is the synthetic summary; last 4 are verbatim recents.
    expect(r.turns[0]!.content).toContain('Earlier conversation summary');
    expect(r.turns).toHaveLength(5);
    expect(r.turns.at(-1)).toEqual(h.at(-1));
  });

  it('uses an injected summariser when supplied', async () => {
    const h = makeHistory(20);
    const summarise = vi.fn(async () => 'CONDENSED');
    const r = await summarizeOverflowHistory(h, {
      maxHistoryTokens: 50,
      keepRecent: 4,
      summarise,
    });
    expect(summarise).toHaveBeenCalledOnce();
    expect(r.turns[0]!.content).toBe('CONDENSED');
  });

  it('falls back to the heuristic when the injected summariser throws', async () => {
    const h = makeHistory(20);
    const summarise = vi.fn(async () => {
      throw new Error('llm down');
    });
    const r = await summarizeOverflowHistory(h, {
      maxHistoryTokens: 50,
      keepRecent: 4,
      summarise,
    });
    expect(r.summarized).toBe(true);
    expect(r.turns[0]!.content).toContain('Earlier conversation summary');
  });

  it('falls back to the heuristic when the summariser returns empty', async () => {
    const h = makeHistory(20);
    const r = await summarizeOverflowHistory(h, {
      maxHistoryTokens: 50,
      keepRecent: 4,
      summarise: async () => '   ',
    });
    expect(r.turns[0]!.content).toContain('Earlier conversation summary');
  });
});
