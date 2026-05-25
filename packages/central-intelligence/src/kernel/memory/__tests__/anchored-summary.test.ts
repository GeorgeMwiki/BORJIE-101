/**
 * Unit tests for `anchored-summary.ts`.
 *
 * Verifies threshold gating, range selection, and persist behaviour
 * against in-memory `LLMPort` and `AnchorSummaryRepo` fakes.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET_THRESHOLD,
  DEFAULT_RETAIN_TAIL_FRACTION,
  approxTokenCount,
  buildSummariserPrompt,
  summariseEarlierTurns,
  type ConversationTurn,
} from '../anchored-summary.js';
import type {
  AnchorSummary,
  AnchorSummaryInsert,
  AnchorSummaryRepo,
  LLMPort,
} from '../types-amem.js';

function makeFakeRepo(): { repo: AnchorSummaryRepo; rows: AnchorSummary[] } {
  const rows: AnchorSummary[] = [];
  let counter = 0;
  const repo: AnchorSummaryRepo = {
    async list(): Promise<ReadonlyArray<AnchorSummary>> {
      return rows;
    },
    async insert(insert: AnchorSummaryInsert): Promise<AnchorSummary> {
      const row: AnchorSummary = {
        id: insert.id ?? `as_${++counter}`,
        tenantId: insert.tenantId,
        sessionId: insert.sessionId,
        startTurnIdx: insert.startTurnIdx,
        endTurnIdx: insert.endTurnIdx,
        summary: insert.summary,
        originalTokens: insert.originalTokens,
        summaryTokens: insert.summaryTokens,
        metadata: insert.metadata ?? {},
        createdAt: new Date('2026-05-21T00:00:00Z'),
      };
      rows.push(row);
      return row;
    },
  };
  return { repo, rows };
}

function makeFakeLlm(response: string): { llm: LLMPort; calls: number } {
  let calls = 0;
  const llm: LLMPort = {
    async complete(): Promise<string> {
      calls += 1;
      return response;
    },
  };
  return {
    llm,
    get calls(): number {
      return calls;
    },
  };
}

const turns: ConversationTurn[] = Array.from({ length: 20 }, (_, i) => ({
  turnIdx: i,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `turn body ${i} `.repeat(50),
  approxTokens: 200,
}));

describe('approxTokenCount', (): void => {
  it('counts ~1 token per 4 chars', (): void => {
    expect(approxTokenCount('abcd')).toBe(1);
    expect(approxTokenCount('abcdefgh')).toBe(2);
  });
  it('returns 0 for empty/non-string', (): void => {
    expect(approxTokenCount('')).toBe(0);
  });
});

describe('buildSummariserPrompt', (): void => {
  it('includes every turn body verbatim', (): void => {
    const prompt = buildSummariserPrompt(turns.slice(0, 3));
    expect(prompt).toContain('[turn 0]');
    expect(prompt).toContain('[turn 1]');
    expect(prompt).toContain('[turn 2]');
    expect(prompt).toContain('user:');
    expect(prompt).toContain('assistant:');
  });
});

describe('summariseEarlierTurns', (): void => {
  it('is a no-op when below threshold', async (): Promise<void> => {
    const { repo, rows } = makeFakeRepo();
    const llm = makeFakeLlm('summary');
    const result = await summariseEarlierTurns({
      tenantId: 't',
      sessionId: 's',
      turns: turns.slice(0, 5), // ~1000 tokens
      contextBudgetTokens: 200_000, // 70% = 140_000 — way over
      llm: llm.llm,
      repo,
    });
    expect(result.summarised).toBe(false);
    expect(result.summary).toBeNull();
    expect(rows.length).toBe(0);
    expect(llm.calls).toBe(0);
  });

  it('summarises and persists when over threshold', async (): Promise<void> => {
    const { repo, rows } = makeFakeRepo();
    const llm = makeFakeLlm('- key fact A\n- key decision B');
    const result = await summariseEarlierTurns({
      tenantId: 't',
      sessionId: 's',
      turns, // 20 * 200 = 4000 tokens
      contextBudgetTokens: 5000, // 70% = 3500 → exceeded
      llm: llm.llm,
      repo,
    });
    expect(result.summarised).toBe(true);
    expect(result.summary).not.toBeNull();
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toContain('key fact A');
    expect(rows[0].startTurnIdx).toBe(0);
    // Tail retention is 30% → head covers ~70% of 4000 = 2800 tokens
    // = 14 turns (200 each) → endTurnIdx ≈ 13.
    expect(rows[0].endTurnIdx).toBeGreaterThan(0);
    expect(rows[0].endTurnIdx).toBeLessThan(20);
  });

  it('fails soft when the LLM throws', async (): Promise<void> => {
    const { repo, rows } = makeFakeRepo();
    const llm: LLMPort = {
      async complete(): Promise<string> {
        throw new Error('LLM down');
      },
    };
    const result = await summariseEarlierTurns({
      tenantId: 't',
      sessionId: 's',
      turns,
      contextBudgetTokens: 5000,
      llm,
      repo,
    });
    expect(result.summarised).toBe(false);
    expect(rows.length).toBe(0);
  });

  it('skips when only one head turn is in scope', async (): Promise<void> => {
    const { repo } = makeFakeRepo();
    const llm = makeFakeLlm('whatever');
    const oneTurn: ConversationTurn[] = [
      {
        turnIdx: 0,
        role: 'user',
        content: 'long body',
        approxTokens: 10_000,
      },
      {
        turnIdx: 1,
        role: 'assistant',
        content: 'short reply',
        approxTokens: 100,
      },
    ];
    const result = await summariseEarlierTurns({
      tenantId: 't',
      sessionId: 's',
      turns: oneTurn,
      contextBudgetTokens: 1000,
      llm: llm.llm,
      repo,
    });
    expect(result.summarised).toBe(false);
  });

  it('exposes documented defaults', (): void => {
    expect(DEFAULT_BUDGET_THRESHOLD).toBeCloseTo(0.7, 5);
    expect(DEFAULT_RETAIN_TAIL_FRACTION).toBeCloseTo(0.3, 5);
  });
});
