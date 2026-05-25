/**
 * Skill retriever — unit tests.
 *
 * Coverage:
 *   1. retrieve returns [] when no embedder
 *   2. retrieve returns [] when embedder throws
 *   3. retrieve forwards (tenantId, limit, maxDistance) to the port
 *   4. retrieve forwards default top-K and maxDistance when caller omits
 *   5. retrieve returns [] when port throws (graceful degrade)
 *   6. retrieve returns [] when userMessage is empty
 *   7. renderPromptFragment emits one bullet per skill
 *   8. renderPromptFragment respects the byte budget
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSkillRetriever,
  DEFAULT_SKILL_MAX_DISTANCE,
  DEFAULT_SKILL_TOP_K,
  type SkillEntry,
  type SkillRetrieverPort,
} from '../skill-retriever.js';
import type { TextEmbedder } from '../../kernel-types.js';

function makePort(): {
  port: SkillRetrieverPort;
  calls: Array<{
    tenantId: string | null;
    embedding: ReadonlyArray<number>;
    limit?: number;
    maxDistance?: number;
  }>;
  failNext?: boolean;
  staged?: ReadonlyArray<SkillEntry>;
} {
  const calls: Array<{
    tenantId: string | null;
    embedding: ReadonlyArray<number>;
    limit?: number;
    maxDistance?: number;
  }> = [];
  const state = { failNext: false, staged: [] as ReadonlyArray<SkillEntry> };
  const port: SkillRetrieverPort = {
    async searchByEmbedding(args) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('port boom');
      }
      const entry: typeof calls[number] = {
        tenantId: args.tenantId,
        embedding: args.embedding,
      };
      if (args.limit !== undefined) entry.limit = args.limit;
      if (args.maxDistance !== undefined) entry.maxDistance = args.maxDistance;
      calls.push(entry);
      return state.staged;
    },
  };
  return Object.assign(state, { port, calls });
}

function makeEmbedder(throws = false): TextEmbedder {
  return {
    async embed(text: string) {
      if (throws) throw new Error('embedder boom');
      // deterministic per text length
      return new Array(1536).fill(0).map((_, i) => (text.length + i) % 7);
    },
  };
}

describe('SkillRetriever.retrieve', () => {
  it('returns [] when no embedder is wired', async () => {
    const stub = makePort();
    const r = createSkillRetriever({ port: stub.port, embedder: null });
    const out = await r.retrieve({
      tenantId: 't-1',
      userMessage: 'help me draft a reminder',
    });
    expect(out).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('returns [] when embedder throws', async () => {
    const stub = makePort();
    const r = createSkillRetriever({
      port: stub.port,
      embedder: makeEmbedder(true),
    });
    const out = await r.retrieve({
      tenantId: 't-1',
      userMessage: 'something',
    });
    expect(out).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('returns [] when user message is blank', async () => {
    const stub = makePort();
    const r = createSkillRetriever({
      port: stub.port,
      embedder: makeEmbedder(),
    });
    const out = await r.retrieve({ tenantId: null, userMessage: '   ' });
    expect(out).toEqual([]);
  });

  it('forwards tenantId, limit, maxDistance to the port', async () => {
    const stub = makePort();
    stub.staged = [stubSkill('s1', 0.1), stubSkill('s2', 0.3)];
    const r = createSkillRetriever({
      port: stub.port,
      embedder: makeEmbedder(),
    });
    const out = await r.retrieve({
      tenantId: 't-1',
      userMessage: 'do a thing',
      limit: 3,
      maxDistance: 0.5,
    });
    expect(out).toHaveLength(2);
    expect(stub.calls[0]).toMatchObject({
      tenantId: 't-1',
      limit: 3,
      maxDistance: 0.5,
    });
  });

  it('uses default top-K and maxDistance when omitted', async () => {
    const stub = makePort();
    stub.staged = [];
    const r = createSkillRetriever({
      port: stub.port,
      embedder: makeEmbedder(),
    });
    await r.retrieve({ tenantId: null, userMessage: 'x' });
    expect(stub.calls[0]).toMatchObject({
      limit: DEFAULT_SKILL_TOP_K,
      maxDistance: DEFAULT_SKILL_MAX_DISTANCE,
    });
  });

  it('returns [] when port throws', async () => {
    const stub = makePort();
    stub.failNext = true;
    const r = createSkillRetriever({
      port: stub.port,
      embedder: makeEmbedder(),
    });
    const out = await r.retrieve({ tenantId: 't-1', userMessage: 'x' });
    expect(out).toEqual([]);
  });
});

describe('SkillRetriever.renderPromptFragment', () => {
  it('emits one bullet per skill', () => {
    const r = createSkillRetriever({
      port: makePort().port,
      embedder: null,
    });
    const out = r.renderPromptFragment([
      stubSkill('a'),
      stubSkill('b'),
      stubSkill('c'),
    ]);
    expect(out).toMatch(/Available learned skills/);
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBe(3);
  });

  it('returns empty when given an empty list', () => {
    const r = createSkillRetriever({
      port: makePort().port,
      embedder: null,
    });
    expect(r.renderPromptFragment([])).toBe('');
  });

  it('respects the byte budget', () => {
    const r = createSkillRetriever({
      port: makePort().port,
      embedder: null,
      maxFragmentChars: 80,
    });
    const longSkills = [
      stubSkill('a', 0.1, 'a very long description that consumes the budget'),
      stubSkill('b', 0.1, 'another long description that should be omitted'),
      stubSkill('c', 0.1, 'and a third one'),
    ];
    const out = r.renderPromptFragment(longSkills);
    // Should include the header + at least one item and a truncation
    // marker. We can't pin the exact char count due to header overhead;
    // just assert the truncation marker is present.
    expect(out).toMatch(/…/);
  });
});

function stubSkill(
  id: string,
  distance = 0.2,
  description = `description-${id}`,
): SkillEntry {
  return {
    id,
    tenantId: null,
    name: `skill-${id}`,
    nlDescription: description,
    toolCallTemplate: {},
    successCount: 5,
    failureCount: 0,
    distance,
  };
}
