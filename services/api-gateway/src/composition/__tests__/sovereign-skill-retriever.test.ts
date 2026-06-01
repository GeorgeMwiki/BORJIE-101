/**
 * Sovereign skill-retriever wiring tests — SKILLS-loop READ side.
 *
 * Verifies the READ half of the Voyager skills loop is now live on the
 * `composeSovereign` (sovereign.ts) path that `brain.hono.ts`'s kernel
 * preflight + the Jarvis routers drive:
 *
 *   - BEHAVIOURAL: the kernel-facing object handed to
 *     `composeSovereign({ skillRetriever })` is a REAL, functional
 *     retriever. Given a fake `skill_registry` port returning rows and a
 *     fake embedder, it retrieves the rows and renders a NON-EMPTY
 *     "Available learned skills:" prompt fragment — exactly what the
 *     kernel mixes into the system prompt at step 4f. The same
 *     `createSkillRetriever` factory `sovereign.ts` imports from
 *     `@borjie/central-intelligence` is exercised here.
 *
 *   - EMBEDDER RESOLVER: `resolveSkillEmbedder()` (exported from
 *     sovereign.ts) returns the always-rejects null embedder when no
 *     OpenAI key is set, so retrieval degrades to an empty fragment
 *     without breaking kernel construction (additive-optional contract).
 *
 *   - SOURCE-LEVEL: parse sovereign.ts and pin the wiring so it cannot
 *     silently regress — the retriever is constructed from the registry
 *     service + the resolved embedder and assigned onto the kernel
 *     `mutable` bag that flows into `composeSovereign`.
 *
 * Mirrors the dual-layer (behavioural + source-level) convention of
 * `sovereign-counter-model.test.ts` in this directory. The full `build()`
 * path is too DB-dense to instantiate without a live Postgres + ~20
 * @borjie/database factories; these assertions are the cheapest faithful
 * guard for the additive wiring.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  createSkillRetriever,
  type SkillEntry,
  type SkillRetrieverPort,
} from '@borjie/central-intelligence';
import { resolveSkillEmbedder } from '../sovereign';

// ---------------------------------------------------------------------------
// BEHAVIOURAL — the kernel-facing retriever is real + non-empty.
// ---------------------------------------------------------------------------

function fakeRegistryPort(rows: ReadonlyArray<SkillEntry>): SkillRetrieverPort {
  return {
    async searchByEmbedding() {
      return rows;
    },
  };
}

function fakeEmbedder(): { embed: (t: string) => Promise<ReadonlyArray<number>> } {
  return {
    async embed() {
      // Any non-empty vector — the fake registry port ignores it and
      // returns the scripted rows; we only need the retriever to get
      // past its `embedding.length === 0` guard.
      return new Array(1536).fill(0.01);
    },
  };
}

const SKILL_ROWS: ReadonlyArray<SkillEntry> = [
  {
    id: 'sk-1',
    tenantId: 't-1',
    name: 'draft late-rent reminder swahili',
    nlDescription:
      'Compose a polite Swahili late-rent reminder citing the lease clause.',
    toolCallTemplate: { intent: 'draft late-rent reminder swahili' },
    successCount: 7,
    failureCount: 0,
    distance: 0.12,
  },
  {
    id: 'sk-2',
    tenantId: 't-1',
    name: 'compute prorated charge',
    nlDescription: 'Compute a mid-month prorated rent charge.',
    toolCallTemplate: { intent: 'compute prorated charge' },
    successCount: 4,
    failureCount: 1,
    distance: 0.21,
  },
];

describe('SKILLS loop — READ side (kernel-facing skill retriever)', () => {
  it('retrieves learned skills and renders a NON-EMPTY prompt fragment', async () => {
    const retriever = createSkillRetriever({
      port: fakeRegistryPort(SKILL_ROWS),
      embedder: fakeEmbedder(),
    });

    const skills = await retriever.retrieve({
      tenantId: 't-1',
      userMessage: 'remind the tenant their rent is late',
    });
    expect(skills.length).toBe(2);

    const fragment = retriever.renderPromptFragment(skills);
    expect(fragment).toContain('**Available learned skills:**');
    expect(fragment).toContain('draft late-rent reminder swahili');
    expect(fragment).toContain('compute prorated charge');
    expect(fragment.length).toBeGreaterThan('**Available learned skills:**'.length);
  });

  it('degrades to an empty fragment when the embedder is null (no OpenAI key)', async () => {
    // This is the exact shape sovereign.ts threads when
    // `resolveSkillEmbedder()` returns the null sentinel: retrieval
    // short-circuits to [] and the kernel skips the addendum.
    const retriever = createSkillRetriever({
      port: fakeRegistryPort(SKILL_ROWS),
      embedder: null,
    });
    const skills = await retriever.retrieve({
      tenantId: 't-1',
      userMessage: 'remind the tenant their rent is late',
    });
    expect(skills).toEqual([]);
    expect(retriever.renderPromptFragment(skills)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// EMBEDDER RESOLVER — null sentinel without a key, real adapter with one.
// ---------------------------------------------------------------------------

describe('resolveSkillEmbedder', () => {
  const ORIGINAL = {
    OPENAI_EMBEDDING_API_KEY: process.env.OPENAI_EMBEDDING_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  afterEach(() => {
    if (ORIGINAL.OPENAI_EMBEDDING_API_KEY === undefined) {
      delete process.env.OPENAI_EMBEDDING_API_KEY;
    } else {
      process.env.OPENAI_EMBEDDING_API_KEY = ORIGINAL.OPENAI_EMBEDDING_API_KEY;
    }
    if (ORIGINAL.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL.OPENAI_API_KEY;
    }
  });

  it('returns the null embedder (modelId="null") when no key is set', () => {
    delete process.env.OPENAI_EMBEDDING_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const embedder = resolveSkillEmbedder();
    expect(embedder.modelId).toBe('null');
  });

  it('returns a real OpenAI embedder (1536 dims) when a key is set', () => {
    delete process.env.OPENAI_EMBEDDING_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-key';
    const embedder = resolveSkillEmbedder();
    expect(embedder.modelId).not.toBe('null');
    expect(embedder.dims).toBe(1536);
  });
});

// ---------------------------------------------------------------------------
// SOURCE-LEVEL — pin the sovereign.ts wiring against silent regression.
// ---------------------------------------------------------------------------

const SOVEREIGN_SOURCE = readFileSync(
  path.resolve(__dirname, '..', 'sovereign.ts'),
  'utf8',
);

describe('sovereign.ts — skill-retriever wiring (source-level guard)', () => {
  it('imports createSkillRetriever from @borjie/central-intelligence', () => {
    expect(SOVEREIGN_SOURCE).toMatch(/createSkillRetriever/);
  });

  it('imports createSkillRegistryService from @borjie/database', () => {
    expect(SOVEREIGN_SOURCE).toMatch(/createSkillRegistryService/);
  });

  it('constructs the retriever from the registry service + resolved embedder', () => {
    expect(SOVEREIGN_SOURCE).toMatch(
      /createSkillRetriever\(\{[\s\S]*?port:\s*createSkillRegistryService\(db\)[\s\S]*?embedder:/,
    );
  });

  it('assigns the retriever onto the kernel mutable bag (→ composeSovereign)', () => {
    expect(SOVEREIGN_SOURCE).toMatch(/mutable\.skillRetriever\s*=\s*skillRetriever/);
  });
});
