/**
 * Tests for `createHaikuConsolidationCritic` — the production Anthropic-
 * Haiku-backed consolidation critic that B2 wires into the consolidation
 * worker's stage 03.
 *
 * Coverage:
 *   1. Happy path — returns a `ReflectionResult` whose `text` carries
 *      the parsed POSITIVE / NEGATIVE / FIX triple.
 *   2. Fallback on Anthropic error — delegates to deterministic stub.
 *   3. Fallback on empty body — same path.
 *   4. Sampling — clusters with > sampleCap traces are downsampled.
 *   5. Cost-bounded — `max_tokens` is forwarded verbatim.
 *   6. Section parser — tolerates out-of-order / missing sections.
 *   7. System prompt + model id can be overridden for tests.
 *   8. Constructor rejects when anthropicClient is omitted.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeHaikuPrompt,
  createHaikuConsolidationCritic,
  HAIKU_CRITIC_SYSTEM_PROMPT,
  maybeSampleTraces,
  parseHaikuTextSections,
  type AnthropicMessagesLike,
  type ConsolidationReflectionCritic,
  type ConsolidationTraceCluster,
  type ConsolidationTraceEntry,
} from '../haiku-critic.js';

function trace(
  i: number,
  overrides: Partial<ConsolidationTraceEntry> = {},
): ConsolidationTraceEntry {
  return {
    traceId: `trace-${i}`,
    tenantId: 'tenant-a',
    userId: 'user-a',
    threadId: `thread-${i}`,
    summary: `agent drafted late-rent reminder #${i}`,
    capturedAt: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function cluster(
  overrides: Partial<ConsolidationTraceCluster> = {},
): ConsolidationTraceCluster {
  return {
    clusterId: 'cluster-1',
    tenantId: 'tenant-a',
    intentLabel: 'draft late-rent reminder Swahili',
    traces: [trace(1), trace(2), trace(3)],
    outcome: 'success',
    score: 0.8,
    signalsInside: 3,
    ...overrides,
  };
}

function fakeAnthropic(
  body: string,
  spy?: (args: unknown) => void,
): AnthropicMessagesLike {
  return {
    messages: {
      create: vi.fn(async (args) => {
        spy?.(args);
        return {
          content: [{ type: 'text', text: body }],
        };
      }),
    },
  };
}

describe('createHaikuConsolidationCritic — happy path', () => {
  it('reflects a cluster, parses sections, returns ReflectionResult', async () => {
    const body = [
      'POSITIVE: All three Swahili reminders were drafted and approved.',
      'NEGATIVE: One reminder was sent at 22:00 outside business hours.',
      'FIX: Add a post-19:00 cutoff to the agent timing policy.',
    ].join('\n');
    const critic = createHaikuConsolidationCritic({
      anthropicClient: fakeAnthropic(body),
    });
    const out = await critic.reflect(cluster());
    expect(out.clusterId).toBe('cluster-1');
    expect(out.tenantId).toBe('tenant-a');
    expect(out.outcome).toBe('success');
    expect(out.intentLabel).toBe('draft late-rent reminder Swahili');
    expect(out.text).toContain('POSITIVE: All three Swahili reminders');
    expect(out.text).toContain('NEGATIVE: One reminder was sent at 22:00');
    expect(out.text).toContain('FIX: Add a post-19:00 cutoff');
    expect(out.text).toContain('haiku-critic[');
  });

  it('forwards model id, max_tokens, and system prompt to Anthropic', async () => {
    const seen: { model?: string; max_tokens?: number; system?: string } = {};
    const client = fakeAnthropic('POSITIVE: ok\nNEGATIVE: ok\nFIX: ok', (a) => {
      const args = a as { model: string; max_tokens: number; system: string };
      seen.model = args.model;
      seen.max_tokens = args.max_tokens;
      seen.system = args.system;
    });
    const critic = createHaikuConsolidationCritic({
      anthropicClient: client,
      modelId: 'claude-haiku-test',
      maxTokens: 250,
    });
    await critic.reflect(cluster());
    expect(seen.model).toBe('claude-haiku-test');
    expect(seen.max_tokens).toBe(250);
    expect(seen.system).toBe(HAIKU_CRITIC_SYSTEM_PROMPT);
  });
});

describe('createHaikuConsolidationCritic — fallback paths', () => {
  it('falls back to deterministic stub when Anthropic throws', async () => {
    const client: AnthropicMessagesLike = {
      messages: {
        create: vi.fn(async () => {
          throw new Error('rate-limited');
        }),
      },
    };
    const warn = vi.fn();
    const critic = createHaikuConsolidationCritic({
      anthropicClient: client,
      logger: { warn },
    });
    const out = await critic.reflect(cluster());
    expect(out.clusterId).toBe('cluster-1');
    expect(out.text).toMatch(/stub-haiku-fallback/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back when Anthropic response body is empty', async () => {
    const critic = createHaikuConsolidationCritic({
      anthropicClient: {
        messages: {
          create: vi.fn(async () => ({ content: [{ type: 'text', text: '' }] })),
        },
      },
    });
    const out = await critic.reflect(cluster());
    expect(out.text).toMatch(/stub-haiku-fallback/);
  });

  it('uses an injected fallbackCritic when Anthropic fails', async () => {
    const fallback: ConsolidationReflectionCritic = {
      reflect: vi.fn(async (c) => ({
        clusterId: c.clusterId,
        tenantId: c.tenantId,
        text: 'INJECTED-FALLBACK',
        outcome: c.outcome,
        intentLabel: c.intentLabel,
      })),
    };
    const critic = createHaikuConsolidationCritic({
      anthropicClient: {
        messages: {
          create: vi.fn(async () => {
            throw new Error('boom');
          }),
        },
      },
      fallbackCritic: fallback,
    });
    const out = await critic.reflect(cluster());
    expect(out.text).toBe('INJECTED-FALLBACK');
    expect(fallback.reflect).toHaveBeenCalledOnce();
  });
});

describe('createHaikuConsolidationCritic — sampling + cost bounds', () => {
  it('samples large clusters down to sampleCap traces', () => {
    const traces = Array.from({ length: 100 }, (_, i) => trace(i));
    const sampled = maybeSampleTraces(traces, 50, () => 0.5);
    expect(sampled.length).toBe(50);
  });

  it('returns the original array when cluster is below cap', () => {
    const traces = Array.from({ length: 12 }, (_, i) => trace(i));
    const sampled = maybeSampleTraces(traces, 50, () => 0.5);
    expect(sampled).toBe(traces);
  });

  it('prompt notes the sampling ratio when traces > cap', async () => {
    const big = cluster({
      traces: Array.from({ length: 75 }, (_, i) => trace(i)),
    });
    let seenPrompt = '';
    const client = fakeAnthropic('POSITIVE: ok\nNEGATIVE: ok\nFIX: ok', (a) => {
      const args = a as { messages: Array<{ content: string }> };
      seenPrompt = String(args.messages[0]?.content ?? '');
    });
    const critic = createHaikuConsolidationCritic({
      anthropicClient: client,
      sampleCap: 50,
      rng: () => 0.5,
    });
    await critic.reflect(big);
    expect(seenPrompt).toContain('Sampled 50 of 75 traces');
  });

  it('composeHaikuPrompt includes intent, outcome, score, traces', () => {
    const c = cluster({ score: -0.4, outcome: 'failure' });
    const prompt = composeHaikuPrompt(c, c.traces);
    expect(prompt).toContain('Cluster intent: draft late-rent reminder Swahili');
    expect(prompt).toContain('Outcome: failure');
    expect(prompt).toContain('Signed score (-1 to 1): -0.40');
    expect(prompt).toContain('agent drafted late-rent reminder #1');
  });

  it('clamps maxTokens to safe bounds', async () => {
    let seenMax = 0;
    const client = fakeAnthropic('POSITIVE: ok\nNEGATIVE: ok\nFIX: ok', (a) => {
      seenMax = (a as { max_tokens: number }).max_tokens;
    });
    const critic = createHaikuConsolidationCritic({
      anthropicClient: client,
      maxTokens: -10, // illegal value — should clamp up to minimum (1)
    });
    await critic.reflect(cluster());
    expect(seenMax).toBeGreaterThanOrEqual(1);
    expect(seenMax).toBeLessThanOrEqual(4000);
  });
});

describe('parseHaikuTextSections', () => {
  it('parses canonical POSITIVE / NEGATIVE / FIX triple', () => {
    const t = parseHaikuTextSections(
      'POSITIVE: good\nNEGATIVE: bad\nFIX: improve',
    );
    expect(t.positive).toBe('good');
    expect(t.negative).toBe('bad');
    expect(t.suggestedFix).toBe('improve');
  });

  it('tolerates lower-case headers and whitespace', () => {
    const t = parseHaikuTextSections(
      '  positive : alpha\n\nnegative: beta\n  fix : gamma  ',
    );
    expect(t.positive).toBe('alpha');
    expect(t.negative).toBe('beta');
    expect(t.suggestedFix).toBe('gamma');
  });

  it('preserves multi-line continuation under the active header', () => {
    const t = parseHaikuTextSections(
      'POSITIVE: hi\ncontinued\nNEGATIVE: bad\nFIX: do it',
    );
    expect(t.positive).toBe('hi continued');
  });

  it('marks missing sections with a placeholder', () => {
    const t = parseHaikuTextSections('POSITIVE: only positive');
    expect(t.positive).toBe('only positive');
    expect(t.negative).toMatch(/no negative/);
    expect(t.suggestedFix).toMatch(/no actionable/);
  });

  it('returns three placeholders for empty input', () => {
    const t = parseHaikuTextSections('');
    expect(t.positive).toMatch(/no positive/);
    expect(t.negative).toMatch(/no negative/);
    expect(t.suggestedFix).toMatch(/no actionable/);
  });
});

describe('createHaikuConsolidationCritic — constructor guards', () => {
  it('throws when anthropicClient is missing', () => {
    expect(() =>
      createHaikuConsolidationCritic({
        // @ts-expect-error — intentional misuse for the guard
        anthropicClient: undefined,
      }),
    ).toThrow(/anthropicClient is required/);
  });
});
