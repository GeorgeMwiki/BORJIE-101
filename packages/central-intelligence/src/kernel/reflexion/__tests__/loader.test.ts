/**
 * Reflexion loader — unit tests.
 *
 * Coverage:
 *   1. returns empty result + empty fragment when tenantId is missing
 *   2. swallows reflexion port errors and still returns guidelines
 *   3. swallows guideline port errors and still returns reflexions
 *   4. forwards optional userId to both ports
 *   5. promptFragment includes BOTH guidelines header + reflexions header when both present
 *   6. reflexions are de-duplicated by cluster_id (one bullet per cluster)
 *   7. per-bullet truncation caps long reflexions at PER_BULLET_MAX_CHARS
 *   8. respects the TOTAL_FRAGMENT_BUDGET with an ellipsis sentinel
 *   9. clamps limit into [1, 25]
 */

import { describe, it, expect } from 'vitest';
import {
  loadReflexions,
  renderPromptFragment,
  type LoadedGuideline,
  type LoadedReflexion,
  type ReflexionLoaderPort,
} from '../reflexion-loader.js';

function makePort(opts: {
  reflexions?: ReadonlyArray<LoadedReflexion>;
  guidelines?: ReadonlyArray<LoadedGuideline>;
  throwReflexions?: boolean;
  throwGuidelines?: boolean;
}): {
  port: ReflexionLoaderPort;
  reflexionCalls: Array<{ tenantId: string; userId?: string; limit: number }>;
  guidelineCalls: Array<{ tenantId: string; userId?: string; limit: number }>;
} {
  const reflexionCalls: Array<{
    tenantId: string;
    userId?: string;
    limit: number;
  }> = [];
  const guidelineCalls: Array<{
    tenantId: string;
    userId?: string;
    limit: number;
  }> = [];
  const port: ReflexionLoaderPort = {
    async recentReflexions(args) {
      const entry: { tenantId: string; userId?: string; limit: number } = {
        tenantId: args.tenantId,
        limit: args.limit,
      };
      if (args.userId !== undefined) entry.userId = args.userId;
      reflexionCalls.push(entry);
      if (opts.throwReflexions) throw new Error('reflexion port boom');
      return opts.reflexions ?? [];
    },
    async recentGuidelines(args) {
      const entry: { tenantId: string; userId?: string; limit: number } = {
        tenantId: args.tenantId,
        limit: args.limit,
      };
      if (args.userId !== undefined) entry.userId = args.userId;
      guidelineCalls.push(entry);
      if (opts.throwGuidelines) throw new Error('guideline port boom');
      return opts.guidelines ?? [];
    },
  };
  return { port, reflexionCalls, guidelineCalls };
}

function mkReflexion(
  id: string,
  opts: Partial<LoadedReflexion> = {},
): LoadedReflexion {
  return {
    id,
    tenantId: 't-1',
    userId: 'u-1',
    sessionId: `sess-${id}`,
    taskId: null,
    reflection: `reflection-${id}`,
    outcome: 'failure',
    importance: 0.5,
    recordedAt: new Date().toISOString(),
    clusterId: null,
    ...opts,
  };
}

function mkGuideline(
  id: string,
  opts: Partial<LoadedGuideline> = {},
): LoadedGuideline {
  return {
    id,
    tenantId: 't-1',
    userId: null,
    slug: `slug-${id}`,
    body: `guideline body ${id}`,
    confidence: 0.7,
    updatedAt: new Date().toISOString(),
    ...opts,
  };
}

describe('loadReflexions', () => {
  it('returns empty when tenantId is missing', async () => {
    const { port, reflexionCalls, guidelineCalls } = makePort({});
    const out = await loadReflexions(port, { tenantId: '' });
    expect(out.reflexions).toEqual([]);
    expect(out.guidelines).toEqual([]);
    expect(out.promptFragment).toBe('');
    expect(reflexionCalls).toHaveLength(0);
    expect(guidelineCalls).toHaveLength(0);
  });

  it('returns guidelines even when reflexions port throws', async () => {
    const guidelines = [mkGuideline('g1')];
    const { port } = makePort({ guidelines, throwReflexions: true });
    const out = await loadReflexions(port, { tenantId: 't-1' });
    expect(out.reflexions).toEqual([]);
    expect(out.guidelines).toEqual(guidelines);
    expect(out.promptFragment).toMatch(/Operating guidelines/);
  });

  it('returns reflexions even when guidelines port throws', async () => {
    const reflexions = [mkReflexion('r1')];
    const { port } = makePort({ reflexions, throwGuidelines: true });
    const out = await loadReflexions(port, { tenantId: 't-1' });
    expect(out.reflexions).toEqual(reflexions);
    expect(out.guidelines).toEqual([]);
    expect(out.promptFragment).toMatch(/Recent reflexions/);
  });

  it('forwards optional userId to both ports', async () => {
    const { port, reflexionCalls, guidelineCalls } = makePort({});
    await loadReflexions(port, { tenantId: 't-1', userId: 'u-7' });
    expect(reflexionCalls[0]?.userId).toBe('u-7');
    expect(guidelineCalls[0]?.userId).toBe('u-7');
  });

  it('renders BOTH headers when guidelines + reflexions both exist', async () => {
    const { port } = makePort({
      reflexions: [mkReflexion('r1', { outcome: 'failure' })],
      guidelines: [mkGuideline('g1')],
    });
    const out = await loadReflexions(port, { tenantId: 't-1' });
    expect(out.promptFragment).toMatch(/Operating guidelines/);
    expect(out.promptFragment).toMatch(/Recent reflexions/);
  });

  it('clamps limit into [1, 25]', async () => {
    const { port, reflexionCalls } = makePort({});
    await loadReflexions(port, { tenantId: 't-1', limit: 0 });
    expect(reflexionCalls[0]?.limit).toBe(1);
    await loadReflexions(port, { tenantId: 't-1', limit: 9999 });
    expect(reflexionCalls[1]?.limit).toBe(25);
  });
});

describe('renderPromptFragment', () => {
  it('collapses cluster duplicates so one bullet per cluster', () => {
    const rep = mkReflexion('rep', { clusterId: null });
    const dup1 = mkReflexion('dup1', { clusterId: 'rep' });
    const dup2 = mkReflexion('dup2', { clusterId: 'rep' });
    const fragment = renderPromptFragment([rep, dup1, dup2], []);
    const bullets = fragment
      .split('\n')
      .filter((l) => l.startsWith('- ['));
    expect(bullets).toHaveLength(1);
  });

  it('per-bullet truncation caps the longest line', () => {
    const long = 'a'.repeat(2_000);
    const r = mkReflexion('rL', { reflection: long, clusterId: null });
    const fragment = renderPromptFragment([r], []);
    const longest = fragment
      .split('\n')
      .map((l) => l.length)
      .reduce((max, x) => (x > max ? x : max), 0);
    // PER_BULLET_MAX_CHARS = 400 + "- [outcome] " prefix slack.
    expect(longest).toBeLessThanOrEqual(420);
  });

  it('emits an ellipsis sentinel when budget is exceeded', () => {
    const giant = 'g'.repeat(595);
    const guidelines = Array.from({ length: 30 }, (_, i) =>
      mkGuideline(`g${i}`, { slug: `unique-${i}`, body: giant }),
    );
    const fragment = renderPromptFragment([], guidelines);
    expect(fragment).toMatch(/^- …$/m);
  });

  it('returns empty string when both lists are empty', () => {
    expect(renderPromptFragment([], [])).toBe('');
  });
});
