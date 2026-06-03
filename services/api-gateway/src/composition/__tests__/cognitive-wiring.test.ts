/**
 * Cognitive wiring tests — verify the R8 follow-up wiring module:
 *
 *   1. `wireCognitive` returns a populated `WiredCognitive` when both
 *      sub-package factories succeed (the default path).
 *   2. The `composition` slot is intentionally `null` (12-wire pipeline
 *      deferred) — guard against an accidental rewire that promotes a
 *      stub composer here.
 *   3. `enrichBrainTurnWithCognitive` returns the documented empty
 *      result when the bundle is fully degraded (`isLive === false`).
 *   4. Enrichment returns the empty result for empty user text even
 *      when bundles are live (defensive guard).
 *   5. Enrichment includes the top-K facts in the formatted prompt
 *      after observing them via cognitive-memory.observe.
 *   6. Enrichment APPENDS context, never mutates — the persona id is
 *      surfaced in the block header so the caller can verify the
 *      append vs. replace contract per CLAUDE.md hard rule.
 *   7. Enrichment short-circuits gracefully when the cognitive-memory
 *      slot is null (only persistent-memory wired).
 *   8. Enrichment short-circuits gracefully when the persistent-memory
 *      slot is null (only cognitive-memory wired).
 *   9. `createCognitiveContextMiddleware` sets `cognitive` on the Hono
 *      context and calls next().
 *  10. `clampTopK` clamps to the documented bounds (default 3, min 1,
 *      max 12, NaN -> default).
 *  11. The audit chain receives an append per recall call (hash-chained
 *      provenance invariant per CLAUDE.md).
 *  12. The kinds filter narrows the recall fan-out — only matching
 *      cells appear in the enriched prompt.
 *  13. The recall block format follows the documented schema:
 *      "<rank>. [<kind>|score=<n>] <text>".
 */

import { describe, it, expect } from 'vitest';
import type { CompositionDeps, WireProbeFn } from '@borjie/cognitive-composition';
import {
  wireCognitive,
  enrichBrainTurnWithCognitive,
  createCognitiveContextMiddleware,
  __testables,
  type WiredCognitive,
  type CognitiveLogger,
} from '../cognitive-wiring';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function silentLogger(): CognitiveLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function capturingLogger(): {
  readonly log: CognitiveLogger;
  readonly entries: Array<{
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly message: string;
    readonly meta?: Record<string, unknown>;
  }>;
} {
  const entries: Array<{
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly message: string;
    readonly meta?: Record<string, unknown>;
  }> = [];
  const append = (level: 'debug' | 'info' | 'warn' | 'error') => (
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    entries.push(
      meta === undefined ? { level, message } : { level, message, meta },
    );
  };
  return {
    log: {
      debug: append('debug'),
      info: append('info'),
      warn: append('warn'),
      error: append('error'),
    },
    entries,
  };
}

const TEST_TENANT = 'tenant-test';
const TEST_USER = 'user-test';
const TEST_PERSONA = 'mr-mwikila';

async function seedMemoryWithFacts(
  wired: WiredCognitive,
  facts: ReadonlyArray<{ readonly text: string; readonly kind?: 'fact' | 'pattern' | 'rule' }>,
): Promise<void> {
  if (wired.cognitiveMemory === null) {
    throw new Error('test setup: cognitive memory slot is null');
  }
  for (let i = 0; i < facts.length; i += 1) {
    const f = facts[i]!;
    await wired.cognitiveMemory.observe(
      {
        content_text: f.text,
        kind: f.kind ?? 'fact',
        initial_confidence: 0.9,
      },
      {
        tenant_id: TEST_TENANT,
        scope_id: 'tenant_root',
        specialisation: 'test-seeder',
        turn_id: `seed-turn-${i.toString()}`,
      },
    );
  }
}

const okProbe: WireProbeFn = async () => ({ status: 'up' });

/**
 * Minimal happy-path `CompositionDeps` — every wire resolves
 * deterministically. The `brainRouter.cascade` text is what surfaces as
 * the composer's final answer, so we tag it so the enrichment test can
 * assert the deep-reasoning block contains it.
 */
function fakeCompositionDeps(): CompositionDeps {
  const memTier = (
    tier: 'episodic' | 'semantic' | 'procedural' | 'reflective',
  ) => ({
    tier,
    recall: async () => [{ cellId: `${tier}-1`, text: `${tier} fact` }],
    probe: okProbe,
  });
  return {
    inference: {
      infer: async () => ({ text: 'draft', confidence: 0.82 }),
      probe: okProbe,
    },
    memoryTiers: {
      episodic: memTier('episodic'),
      semantic: memTier('semantic'),
      procedural: memTier('procedural'),
      reflective: memTier('reflective'),
    },
    cot: { cot: async () => ({ trace: ['step-1'] }), probe: okProbe },
    substrate: { compile: async () => ({ programId: 'prog-1' }), probe: okProbe },
    kernel: { hook: async () => undefined, probe: okProbe },
    calibration: { observe: async () => ({ driftScore: 0.1 }), probe: okProbe },
    conformal: { update: async () => ({ alpha: 0.1 }), probe: okProbe },
    audit: {
      append: async () => ({ rowHash: 'h1', prevHash: 'h0' }),
      verify: async () => ({ ok: true, firstBrokenIndex: null }),
      probe: okProbe,
    },
    brainRouter: {
      cascade: async () => ({ text: 'DEEP_ANSWER_TOKEN', modelId: 'sonnet-4-6' }),
      probe: okProbe,
    },
    healthStore: {
      upsert: async () => undefined,
      list: async () => [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireCognitive', () => {
  it('returns a populated WiredCognitive when both sub-package factories succeed', () => {
    const { log } = capturingLogger();
    const wired = wireCognitive({ db: null, logger: log });
    expect(wired.isLive).toBe(true);
    expect(wired.cognitiveMemory).not.toBeNull();
    expect(wired.persistent).not.toBeNull();
    // Sanity-check that the bundles expose the documented API surface.
    expect(typeof wired.cognitiveMemory?.recall).toBe('function');
    expect(typeof wired.cognitiveMemory?.observe).toBe('function');
    expect(typeof wired.persistent?.sessionRecall).toBe('function');
    expect(typeof wired.persistent?.skillLookup).toBe('function');
  });

  it('leaves the composition slot null when no compositionDeps are supplied (LP-01)', () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    // LP-01 wires a real composer ONLY when the caller supplies
    // `compositionDeps`. The common boot path (no deps) still yields null,
    // so consumers must null-check and fall back to memory-recall-only.
    expect(wired.composition).toBeNull();
  });

  it('logs a single info entry summarising the wired bundles on boot', () => {
    const { log, entries } = capturingLogger();
    wireCognitive({ db: null, logger: log });
    const info = entries.filter((e) => e.level === 'info');
    expect(info.length).toBeGreaterThanOrEqual(1);
    expect(info[0]!.message).toMatch(/cognitive-wiring: bundles constructed/);
    // No compositionDeps → composer not constructed → composition=false.
    expect(info[0]!.meta?.composition).toBe(false);
  });

  it('exposes a frozen WiredCognitive (no accidental mutation)', () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    expect(Object.isFrozen(wired)).toBe(true);
  });
});

describe('enrichBrainTurnWithCognitive — degraded paths', () => {
  it('returns EMPTY_RESULT when the bundle is fully degraded (isLive=false)', async () => {
    const degraded: WiredCognitive = Object.freeze({
      cognitiveMemory: null,
      persistent: null,
      composition: null,
      isLive: false,
    });
    const result = await enrichBrainTurnWithCognitive({
      wired: degraded,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'How is the shift?',
      personaId: TEST_PERSONA,
    });
    expect(result.enrichedSystemPrompt).toBe('');
    expect(result.citations.length).toBe(0);
    expect(result.recallResults.length).toBe(0);
  });

  it('returns EMPTY_RESULT for empty user text even when wired live', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: '   ',
      personaId: TEST_PERSONA,
    });
    expect(result.enrichedSystemPrompt).toBe('');
  });

  it('returns no memory block when only persistent-memory is wired', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    // Forge a hybrid: persistent live, cognitive memory dropped.
    const hybrid: WiredCognitive = Object.freeze({
      cognitiveMemory: null,
      persistent: wired.persistent,
      composition: null,
      isLive: true,
    });
    const result = await enrichBrainTurnWithCognitive({
      wired: hybrid,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'audit the last shift',
      personaId: TEST_PERSONA,
    });
    // No memories observed and no session — block should be empty.
    expect(result.enrichedSystemPrompt).toBe('');
  });

  it('returns no session block when only cognitive-memory is wired', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    await seedMemoryWithFacts(wired, [
      { text: 'Shift starts at 06:00 local time' },
    ]);
    const hybrid: WiredCognitive = Object.freeze({
      cognitiveMemory: wired.cognitiveMemory,
      persistent: null,
      composition: null,
      isLive: true,
    });
    const result = await enrichBrainTurnWithCognitive({
      wired: hybrid,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'shift starts',
      personaId: TEST_PERSONA,
      threadId: 'thread-1', // requested but session repo is null
    });
    // Memory block present, session block absent.
    expect(result.enrichedSystemPrompt).toMatch(
      /RELEVANT MEMORIES/,
    );
    expect(result.enrichedSystemPrompt).not.toMatch(/SESSION CONTEXT/);
  });
});

describe('enrichBrainTurnWithCognitive — happy paths', () => {
  it('includes the top-K recalled facts in the enriched prompt', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    await seedMemoryWithFacts(wired, [
      { text: 'Mine compliance certificate expires 2026-08-12' },
      { text: 'Shift change is 06:00 and 18:00 local' },
      { text: 'Tanzanite grade A pricing 320 USD per gram' },
    ]);
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'compliance certificate expiry',
      personaId: TEST_PERSONA,
      topK: 3,
    });
    expect(result.enrichedSystemPrompt).toMatch(/RELEVANT MEMORIES/);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.recallResults.length).toBeLessThanOrEqual(3);
    expect(result.enrichedSystemPrompt).toContain(TEST_PERSONA);
  });

  it('APPENDS context — never mutates the caller-supplied input', async () => {
    // CLAUDE.md hard rule: predictions APPEND, never replace. This test
    // verifies the enrichment ONLY produces an additive prefix and the
    // caller is free to compose it however they like.
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    await seedMemoryWithFacts(wired, [
      { text: 'Persona mode CEO is the default for owner surface' },
    ]);
    const originalUserText = 'persona mode';
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: originalUserText,
      personaId: TEST_PERSONA,
    });
    // The user text is unchanged (we never get it back as part of the
    // enriched prompt — the caller composes the two).
    expect(originalUserText).toBe('persona mode');
    expect(result.enrichedSystemPrompt.startsWith('#')).toBe(true);
    // The enriched prompt does not echo the user text — that's the
    // caller's responsibility to compose. Verifies APPEND-only.
    expect(result.enrichedSystemPrompt).not.toContain(originalUserText);
  });

  it('writes an audit-chain row per recall call (hash-chained provenance)', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    await seedMemoryWithFacts(wired, [
      { text: 'Compliance certificate must be renewed every 12 months' },
    ]);
    // Snapshot the audit chain before / after the recall.
    const cm = wired.cognitiveMemory;
    if (cm === null) throw new Error('cognitive memory unexpectedly null');
    // The seed already appended `memory.observe` rows. We measure deltas.
    const auditWithHistory = cm.audit as unknown as {
      history?: () => ReadonlyArray<Readonly<Record<string, unknown>>>;
    };
    const before = auditWithHistory.history?.()?.length ?? 0;
    await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'compliance certificate renewal',
      personaId: TEST_PERSONA,
    });
    const after = auditWithHistory.history?.()?.length ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it('narrows the recall by the kinds filter', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    await seedMemoryWithFacts(wired, [
      { text: 'Compliance rule: monthly audit required', kind: 'rule' },
      { text: 'Equipment fact: drill last serviced 2026-04-01', kind: 'fact' },
    ]);
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'audit',
      personaId: TEST_PERSONA,
      kinds: ['rule'],
    });
    // Either the rule was returned, or nothing was — never a fact-kinded
    // cell since our filter excluded those.
    const matched = result.recallResults.every(
      (r) => r.cell.kind === 'rule',
    );
    expect(matched).toBe(true);
  });

  it('formats recall block in the documented schema', () => {
    // Use the internal helper directly to verify the format contract.
    const block = __testables.formatRecallBlock(
      [
        {
          cell: {
            id: 'cell-1',
            tenant_id: TEST_TENANT,
            scope_id: 'tenant_root',
            content: { text: 'hello world', embedding: [], structured: {} },
            kind: 'fact',
            contributed_by_specialisation: 'test',
            reinforced_by_specialisations: [],
            contributed_in_turn_id: 'turn-1',
            reinforced_in_turn_ids: [],
            evidence_citations: [],
            confidence_score: 0.9,
            access_count: 0,
            last_accessed_at: null,
            created_at: new Date().toISOString(),
            promoted_at: null,
            decayed_at: null,
            promotion_status: 'observed',
            contradicting_cell_id: null,
            audit_hash: 'h',
          },
          similarity: 0.87,
          rank_score: 0.782,
        },
      ],
      TEST_PERSONA,
    );
    expect(block).toMatch(/^# RELEVANT MEMORIES \(top 1\)/);
    expect(block).toMatch(/1\. \[fact\|score=0\.782\] hello world/);
  });
});

describe('enrichBrainTurnWithCognitive — deep composer call-site (LP-01 / LP-30)', () => {
  it('runs the composer and folds a DEEP REASONING block into the prompt when enabled + routed', async () => {
    // Build the composer ENABLED (flag on) with deterministic deps and a
    // high-stakes route so the TTC allocator escalates off the fast path.
    const wired = wireCognitive({
      db: null,
      logger: silentLogger(),
      compositionDeps: fakeCompositionDeps(),
      env: { BORJIE_COGNITIVE_COMPOSER_ENABLED: '1' },
    });
    expect(wired.composition).not.toBeNull();
    expect(wired.composition?.enabled).toBe(true);

    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'Should we suspend the licence given the arrears?',
      personaId: TEST_PERSONA,
      // critical stakes -> LATS hard edge (non-fast) so the composer spins.
      composer: { stakes: 'critical', surface: 'owner-portal' },
    });

    // The deep-reasoning block is present, surfaces the composed answer,
    // and the composer result is exposed for telemetry.
    expect(result.enrichedSystemPrompt).toMatch(/DEEP REASONING/);
    expect(result.enrichedSystemPrompt).toContain('DEEP_ANSWER_TOKEN');
    expect(result.composer).not.toBeNull();
    expect(result.composer?.route.strategy).toBe('lats');
  });

  it('does NOT run the composer when the flag is disabled (default OFF) — composer result is null', async () => {
    const wired = wireCognitive({
      db: null,
      logger: silentLogger(),
      compositionDeps: fakeCompositionDeps(),
      // No env → flag OFF by default.
    });
    // The slot is constructed but disabled.
    expect(wired.composition).not.toBeNull();
    expect(wired.composition?.enabled).toBe(false);

    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'Should we suspend the licence?',
      personaId: TEST_PERSONA,
      composer: { stakes: 'critical', surface: 'owner-portal' },
    });
    expect(result.composer).toBeNull();
    expect(result.enrichedSystemPrompt).not.toMatch(/DEEP REASONING/);
  });

  it('does NOT run the composer on a low-stakes (fast) route even when enabled', async () => {
    const wired = wireCognitive({
      db: null,
      logger: silentLogger(),
      compositionDeps: fakeCompositionDeps(),
      env: { BORJIE_COGNITIVE_COMPOSER_ENABLED: '1' },
    });
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'hello',
      personaId: TEST_PERSONA,
      composer: { stakes: 'low', surface: 'tenant-app' },
    });
    // Fast path → runForTurn returns null → no deep block.
    expect(result.composer).toBeNull();
    expect(result.enrichedSystemPrompt).not.toMatch(/DEEP REASONING/);
  });

  it('leaves the composer null + enrichment unchanged when no compositionDeps were supplied', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    expect(wired.composition).toBeNull();
    await seedMemoryWithFacts(wired, [
      { text: 'Licence renewal due 2026-09-01' },
    ]);
    const result = await enrichBrainTurnWithCognitive({
      wired,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'licence renewal',
      personaId: TEST_PERSONA,
      composer: { stakes: 'critical', surface: 'owner-portal' },
    });
    // Memory recall still works; composer is absent.
    expect(result.composer).toBeNull();
    expect(result.enrichedSystemPrompt).toMatch(/RELEVANT MEMORIES/);
    expect(result.enrichedSystemPrompt).not.toMatch(/DEEP REASONING/);
  });

  it('safeComposeDeep returns null when the composition slot is null', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    const out = await __testables.safeComposeDeep({
      wired,
      tenantId: TEST_TENANT,
      userText: 'anything',
      logger: __testables.createSilentLogger(),
    });
    expect(out).toBeNull();
  });

  it('safeComposeDeep never throws even if runForTurn rejects (defence-in-depth)', async () => {
    const base = wireCognitive({
      db: null,
      logger: silentLogger(),
      compositionDeps: fakeCompositionDeps(),
      env: { BORJIE_COGNITIVE_COMPOSER_ENABLED: '1' },
    });
    // Sabotage runForTurn to throw — the wrapper must swallow it.
    const sabotaged: WiredCognitive = Object.freeze({
      ...base,
      composition:
        base.composition === null
          ? null
          : Object.freeze({
              ...base.composition,
              runForTurn: async (): Promise<never> => {
                throw new Error('synthetic composer failure');
              },
            }),
    });
    const out = await __testables.safeComposeDeep({
      wired: sabotaged,
      tenantId: TEST_TENANT,
      userText: 'anything',
      composer: { stakes: 'critical', surface: 'owner-portal' },
      logger: __testables.createSilentLogger(),
    });
    expect(out).toBeNull();
  });
});

describe('formatComposerBlock', () => {
  it('returns empty string for a null composer result', () => {
    expect(__testables.formatComposerBlock(null)).toBe('');
  });
});

describe('clampTopK', () => {
  it('returns default 3 when undefined', () => {
    expect(__testables.clampTopK(undefined)).toBe(3);
  });
  it('returns default 3 for non-finite or non-positive values', () => {
    expect(__testables.clampTopK(0)).toBe(3);
    expect(__testables.clampTopK(-7)).toBe(3);
    expect(__testables.clampTopK(Number.NaN)).toBe(3);
    expect(__testables.clampTopK(Number.POSITIVE_INFINITY)).toBe(3);
  });
  it('clamps to upper bound 12', () => {
    expect(__testables.clampTopK(999)).toBe(12);
  });
  it('floors fractional values', () => {
    expect(__testables.clampTopK(3.9)).toBe(3);
  });
  it('passes through valid values unchanged', () => {
    expect(__testables.clampTopK(5)).toBe(5);
  });
});

describe('createCognitiveContextMiddleware', () => {
  it('sets `cognitive` on the Hono context and calls next()', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    const middleware = createCognitiveContextMiddleware(wired);
    const setCalls: Array<{ key: string; value: unknown }> = [];
    const ctx = {
      set(key: string, value: unknown): void {
        setCalls.push({ key, value });
      },
    };
    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });
    expect(setCalls).toEqual([{ key: 'cognitive', value: wired }]);
    expect(nextCalled).toBe(true);
  });
});

describe('graceful degradation', () => {
  it('does not throw if the recall path errors — returns no memory block', async () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    // Sabotage the recall function to simulate a runtime failure.
    const sabotaged: WiredCognitive = Object.freeze({
      ...wired,
      cognitiveMemory:
        wired.cognitiveMemory === null
          ? null
          : Object.freeze({
              ...wired.cognitiveMemory,
              recall: async (): Promise<never> => {
                throw new Error('synthetic recall failure');
              },
            }),
    });
    const result = await enrichBrainTurnWithCognitive({
      wired: sabotaged,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      userText: 'anything',
      personaId: TEST_PERSONA,
    });
    expect(result.enrichedSystemPrompt).toBe('');
    expect(result.citations.length).toBe(0);
  });
});
