/**
 * Reflexion retriever — unit tests.
 *
 * Coverage:
 *   1. retrieve returns rows from the port
 *   2. retrieve returns [] when (tenantId|userId) is missing
 *   3. retrieve returns [] when the port throws
 *   4. retrieve forwards the limit + bumpTelemetry flags
 *   5. renderPromptFragment emits a header + one bullet per entry
 *   6. renderPromptFragment returns '' on empty list
 *   7. renderPromptFragment respects the byte budget
 *   8. renderPromptFragment truncates long reflections to PER_ENTRY_MAX
 */

import { describe, it, expect } from 'vitest';
import {
  createReflexionRetriever,
  DEFAULT_REFLEXION_LIMIT,
  type ReflexionEntry,
  type ReflexionRetrieverPort,
} from '../reflexion-retriever.js';

function makePort(): {
  port: ReflexionRetrieverPort;
  calls: Array<{
    tenantId: string;
    userId: string;
    limit?: number;
    bumpTelemetry?: boolean;
  }>;
  failNext?: boolean;
  staged: ReflexionEntry[];
} {
  const calls: Array<{
    tenantId: string;
    userId: string;
    limit?: number;
    bumpTelemetry?: boolean;
  }> = [];
  const state = { failNext: false, staged: [] as ReflexionEntry[] };
  const port: ReflexionRetrieverPort = {
    async recall(args) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('boom');
      }
      const entry: typeof calls[number] = {
        tenantId: args.tenantId,
        userId: args.userId,
      };
      if (args.limit !== undefined) entry.limit = args.limit;
      if (args.bumpTelemetry !== undefined) {
        entry.bumpTelemetry = args.bumpTelemetry;
      }
      calls.push(entry);
      return state.staged;
    },
  };
  return Object.assign(state, { port, calls });
}

describe('ReflexionRetriever.retrieve', () => {
  it('returns rows from the port', async () => {
    const stub = makePort();
    stub.staged = [makeEntry('r1', 'success'), makeEntry('r2', 'mixed')];
    const r = createReflexionRetriever({ port: stub.port });
    const out = await r.retrieve({ tenantId: 't-1', userId: 'u-1' });
    expect(out).toHaveLength(2);
  });

  it('returns [] when tenantId or userId is missing', async () => {
    const stub = makePort();
    const r = createReflexionRetriever({ port: stub.port });
    expect(await r.retrieve({ tenantId: '', userId: 'u-1' })).toEqual([]);
    expect(await r.retrieve({ tenantId: 't-1', userId: '' })).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('returns [] when port throws', async () => {
    const stub = makePort();
    stub.failNext = true;
    const r = createReflexionRetriever({ port: stub.port });
    const out = await r.retrieve({ tenantId: 't-1', userId: 'u-1' });
    expect(out).toEqual([]);
  });

  it('forwards limit + bumpTelemetry to the port (default limit)', async () => {
    const stub = makePort();
    const r = createReflexionRetriever({ port: stub.port });
    await r.retrieve({ tenantId: 't-1', userId: 'u-1' });
    expect(stub.calls[0]?.limit).toBe(DEFAULT_REFLEXION_LIMIT);

    await r.retrieve({
      tenantId: 't-1',
      userId: 'u-1',
      limit: 10,
      bumpTelemetry: false,
    });
    expect(stub.calls[1]?.limit).toBe(10);
    expect(stub.calls[1]?.bumpTelemetry).toBe(false);
  });
});

describe('ReflexionRetriever.renderPromptFragment', () => {
  it('emits a header and bullets', () => {
    const r = createReflexionRetriever({ port: makePort().port });
    const out = r.renderPromptFragment([
      makeEntry('r1', 'success', 'never quote rent without lease ref'),
      makeEntry('r2', 'failure', 'wrong unit number fuzzy-matched'),
    ]);
    expect(out).toMatch(/Recent reflections/);
    expect(out).toMatch(/\[success\]/);
    expect(out).toMatch(/\[failure\]/);
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBe(2);
  });

  it('returns empty for empty input', () => {
    const r = createReflexionRetriever({ port: makePort().port });
    expect(r.renderPromptFragment([])).toBe('');
  });

  it('respects the byte budget', () => {
    const r = createReflexionRetriever({
      port: makePort().port,
      maxFragmentChars: 100,
    });
    const out = r.renderPromptFragment([
      makeEntry('r1', 'success', 'x'.repeat(60)),
      makeEntry('r2', 'failure', 'y'.repeat(60)),
      makeEntry('r3', 'mixed', 'z'.repeat(60)),
    ]);
    expect(out).toMatch(/…/);
  });

  it('truncates long reflections per-entry', () => {
    const r = createReflexionRetriever({ port: makePort().port });
    const long = 'a'.repeat(2_000);
    const out = r.renderPromptFragment([makeEntry('r1', 'success', long)]);
    // PER_ENTRY_MAX = 400; allow for trailing ellipsis byte.
    const longestLine = out
      .split('\n')
      .map((l) => l.length)
      .reduce((max, x) => (x > max ? x : max), 0);
    expect(longestLine).toBeLessThanOrEqual(420);
  });
});

function makeEntry(
  id: string,
  outcome: ReflexionEntry['outcome'],
  reflection = `reflection-${id}`,
): ReflexionEntry {
  return {
    id,
    tenantId: 't-1',
    userId: 'u-1',
    sessionId: `sess-${id}`,
    reflection,
    outcome,
    recordedAt: new Date().toISOString(),
  };
}
