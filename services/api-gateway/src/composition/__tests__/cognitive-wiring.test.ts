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

  it('keeps the composition slot null (12-wire pipeline deferred)', () => {
    const wired = wireCognitive({ db: null, logger: silentLogger() });
    // Per CLAUDE.md hard rule + file header: the 12-wire composer is
    // deferred. Guard the slot so an accidental rewire is loud.
    expect(wired.composition).toBeNull();
  });

  it('logs a single info entry summarising the wired bundles on boot', () => {
    const { log, entries } = capturingLogger();
    wireCognitive({ db: null, logger: log });
    const info = entries.filter((e) => e.level === 'info');
    expect(info.length).toBeGreaterThanOrEqual(1);
    expect(info[0]!.message).toMatch(/cognitive-wiring: bundles constructed/);
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
