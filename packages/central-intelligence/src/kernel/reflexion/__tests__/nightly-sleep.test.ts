/**
 * Nightly sleep — unit tests covering each of the 4 passes plus the
 * orchestrator integration. 12 tests total (the task spec asks for 8+).
 *
 * Pass-1: clustering / representative selection / port wiring.
 * Pass-2: trigger/action extraction / confidence / candidate emission.
 * Pass-3: slug-dedupe insert/overwrite/append behaviour.
 * Pass-4: importance-adjusted age cutoff + soft-prune.
 * Integration: orchestrator sequences passes 1→2→3→4 and aggregates.
 */

import { describe, it, expect } from 'vitest';
import {
  bigramSet,
  clusterReflexions,
  jaccard,
  pickRepresentative,
  runDedupeClusterPass,
  type DedupeClusterPort,
} from '../sleep/pass-1-dedupe-cluster.js';
import {
  computeConfidence,
  extractTriggerAction,
  makeSlug,
  runExtractPatternsPass,
  type ExtractPatternsPort,
} from '../sleep/pass-2-extract-patterns.js';
import {
  composeBody,
  mergeSourceIds,
  runUpdateGuidelinesPass,
  type UpdateGuidelinesPort,
} from '../sleep/pass-3-update-guidelines.js';
import {
  effectiveMaxAgeDays,
  runPruneStalePass,
  shouldPrune,
  type PruneStalePort,
} from '../sleep/pass-4-prune-stale.js';
import {
  runNightlySleep,
  type NightlySleepPorts,
} from '../sleep/nightly-sleep.js';
import type { LoadedReflexion } from '../reflexion-loader.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function mkRow(opts: Partial<LoadedReflexion>): LoadedReflexion {
  return {
    id: 'r1',
    tenantId: 't-1',
    userId: 'u-1',
    sessionId: 'sess',
    taskId: null,
    reflection: 'reflection text',
    outcome: 'failure',
    importance: 0.5,
    recordedAt: new Date().toISOString(),
    clusterId: null,
    ...opts,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pass 1
// ─────────────────────────────────────────────────────────────────────

describe('pass-1 dedupe-cluster', () => {
  it('clusters near-duplicate reflexions and picks the newest/highest-importance representative', () => {
    const now = Date.parse('2026-05-22T00:00:00Z');
    const rows: LoadedReflexion[] = [
      mkRow({
        id: 'r-old',
        reflection: 'forgot to confirm the unit number before quoting rent',
        recordedAt: new Date(now - 3 * DAY_MS).toISOString(),
        importance: 0.4,
      }),
      mkRow({
        id: 'r-new',
        reflection: 'forgot to confirm the unit number before quoting rent again',
        recordedAt: new Date(now - 1 * DAY_MS).toISOString(),
        importance: 0.6,
      }),
      mkRow({
        id: 'r-other',
        reflection: 'completely unrelated topic about water bills',
        recordedAt: new Date(now - 2 * DAY_MS).toISOString(),
      }),
    ];
    const clusters = clusterReflexions(rows, 0.5);
    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.length === 2)!;
    expect(big).toBeDefined();
    expect(pickRepresentative(big)?.id).toBe('r-new');
  });

  it('writes cluster_id on each duplicate via the port', async () => {
    const rows: LoadedReflexion[] = [
      mkRow({
        id: 'rep',
        reflection: 'forgot to confirm the unit number',
        recordedAt: new Date().toISOString(),
        importance: 0.7,
      }),
      mkRow({
        id: 'dup',
        reflection: 'forgot to confirm the unit number again',
        recordedAt: new Date(Date.now() - 1000).toISOString(),
        importance: 0.5,
      }),
    ];
    const updates: Array<{ rowId: string; clusterId: string | null }> = [];
    const port: DedupeClusterPort = {
      async loadRecent() {
        return rows;
      },
      async updateClusterId(args) {
        updates.push({ rowId: args.rowId, clusterId: args.clusterId });
      },
    };
    const report = await runDedupeClusterPass(port, { tenantId: 't-1' });
    expect(report.clusters).toBe(1);
    expect(report.duplicatesLinked).toBe(1);
    // Dup's cluster_id should equal rep's id; rep itself should get null.
    const dupUpdate = updates.find((u) => u.rowId === 'dup');
    expect(dupUpdate?.clusterId).toBe('rep');
  });

  it('exposes bigramSet + jaccard primitives correctly', () => {
    const a = bigramSet('abcd');
    expect(a).toEqual(new Set(['ab', 'bc', 'cd']));
    const b = bigramSet('abcd');
    expect(jaccard(a, b)).toBe(1);
    const c = bigramSet('zzzz');
    expect(jaccard(a, c)).toBe(0);
  });

  it('skips invalid args without touching the port', async () => {
    let called = false;
    const port: DedupeClusterPort = {
      async loadRecent() {
        called = true;
        return [];
      },
      async updateClusterId() {
        called = true;
      },
    };
    const report = await runDedupeClusterPass(port, { tenantId: '' });
    expect(report.notes).toMatch(/invalid args/);
    expect(called).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pass 2
// ─────────────────────────────────────────────────────────────────────

describe('pass-2 extract-patterns', () => {
  it('extracts trigger + action from a cause/remedy reflexion line', () => {
    const out = extractTriggerAction(
      'I assumed the unit was 4B but the user said 4F. Next time ask before fuzzy-matching.',
    );
    expect(out.trigger.toLowerCase()).toContain('assumed');
    expect(out.suggestedAction.toLowerCase()).toMatch(/ask|next time/);
  });

  it('falls back to a generic action when no remedy keyword present', () => {
    const out = extractTriggerAction('I forgot to verify the lease anniversary.');
    expect(out.trigger.length).toBeGreaterThan(0);
    expect(out.suggestedAction).toBe('review carefully before proceeding');
  });

  it('computeConfidence weights failure fraction the most', () => {
    const lowFailure = computeConfidence({
      clusterSize: 10,
      failureFraction: 0,
      importanceMean: 1,
    });
    const highFailure = computeConfidence({
      clusterSize: 2,
      failureFraction: 1,
      importanceMean: 0,
    });
    expect(highFailure).toBeGreaterThan(lowFailure);
  });

  it('emits a candidate when support + failure-dominance hold', async () => {
    const now = new Date().toISOString();
    const rep = mkRow({
      id: 'rep',
      reflection:
        'Lessons:\n- I assumed lease anniversary was 1st but next time ask the tenant',
      recordedAt: now,
    });
    const members: LoadedReflexion[] = [
      rep,
      mkRow({ id: 'm2', reflection: 'forgot anniversary', clusterId: 'rep' }),
    ];
    const port: ExtractPatternsPort = {
      async loadActiveRepresentatives() {
        return [rep];
      },
      async loadClusterMembers() {
        return members;
      },
    };
    const report = await runExtractPatternsPass(port, { tenantId: 't-1' });
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]?.representativeId).toBe('rep');
    expect(report.candidates[0]?.slug).toMatch(/^rg:/);
  });

  it('drops candidates when failure dominance below 50%', async () => {
    const rep = mkRow({
      id: 'rep',
      reflection: 'I assumed X — next time confirm.',
      outcome: 'success',
    });
    const port: ExtractPatternsPort = {
      async loadActiveRepresentatives() {
        return [rep];
      },
      async loadClusterMembers() {
        return [
          rep,
          mkRow({ id: 'm2', outcome: 'success', clusterId: 'rep' }),
        ];
      },
    };
    const report = await runExtractPatternsPass(port, { tenantId: 't-1' });
    expect(report.candidates).toHaveLength(0);
  });

  it('slug is stable + case-insensitive for the same (trigger, action) pair', () => {
    expect(makeSlug('Assumed unit 4B', 'next time ask')).toBe(
      makeSlug('ASSUMED UNIT 4b', 'next time ask'),
    );
    // Different (trigger, action) pairs map to distinct slugs.
    expect(makeSlug('Assumed unit 4B', 'next time ask')).not.toBe(
      makeSlug('Assumed unit 4B', 'always confirm'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pass 3
// ─────────────────────────────────────────────────────────────────────

describe('pass-3 update-guidelines', () => {
  it('inserts a new guideline when the slug does not exist yet', async () => {
    const inserts: Array<{
      slug: string;
      body: string;
      confidence: number;
    }> = [];
    const port: UpdateGuidelinesPort = {
      async loadBySlug() {
        return null;
      },
      async insert(args) {
        inserts.push({
          slug: args.slug,
          body: args.body,
          confidence: args.confidence,
        });
        return { id: 'g-new' };
      },
      async update() {
        throw new Error('should not update');
      },
    };
    const report = await runUpdateGuidelinesPass(port, {
      tenantId: 't-1',
      candidates: [
        {
          representativeId: 'rep',
          clusterSize: 3,
          failureCount: 3,
          trigger: 'I assumed the unit number',
          suggestedAction: 'next time ask',
          confidence: 0.8,
          slug: 'rg:abc',
          sourceReflexionIds: ['rep', 'd1', 'd2'],
        },
      ],
    });
    expect(report.inserted).toBe(1);
    expect(inserts[0]?.slug).toBe('rg:abc');
    expect(inserts[0]?.body.toLowerCase()).toMatch(/^when /);
  });

  it('overwrites when new confidence >= existing; source-only append otherwise', async () => {
    let existing = {
      id: 'g-1',
      body: 'old body',
      confidence: 0.5,
      sourceReflexionIds: ['rep-old'] as ReadonlyArray<string>,
    };
    const updates: Array<{
      body?: string;
      confidence?: number;
      sources: ReadonlyArray<string>;
    }> = [];
    const port: UpdateGuidelinesPort = {
      async loadBySlug() {
        return existing;
      },
      async insert() {
        throw new Error('should not insert');
      },
      async update(args) {
        const entry: {
          body?: string;
          confidence?: number;
          sources: ReadonlyArray<string>;
        } = {
          sources: args.sourceReflexionIds,
        };
        if (args.body !== undefined) entry.body = args.body;
        if (args.confidence !== undefined) entry.confidence = args.confidence;
        updates.push(entry);
      },
    };
    // Higher confidence ⇒ overwrite.
    await runUpdateGuidelinesPass(port, {
      tenantId: 't-1',
      candidates: [
        {
          representativeId: 'rep',
          clusterSize: 4,
          failureCount: 4,
          trigger: 'forgot to confirm unit',
          suggestedAction: 'always ask',
          confidence: 0.9,
          slug: 'rg:abc',
          sourceReflexionIds: ['rep-new'],
        },
      ],
    });
    expect(updates[0]?.body).toBeDefined();
    expect(updates[0]?.confidence).toBe(0.9);
    expect(updates[0]?.sources).toEqual(
      expect.arrayContaining(['rep-old', 'rep-new']),
    );

    // Lower confidence ⇒ append sources only.
    existing = { ...existing, confidence: 0.95 };
    updates.length = 0;
    await runUpdateGuidelinesPass(port, {
      tenantId: 't-1',
      candidates: [
        {
          representativeId: 'rep',
          clusterSize: 2,
          failureCount: 2,
          trigger: 't',
          suggestedAction: 'a',
          confidence: 0.5,
          slug: 'rg:abc',
          sourceReflexionIds: ['rep-newer'],
        },
      ],
    });
    expect(updates[0]?.body).toBeUndefined();
    expect(updates[0]?.confidence).toBeUndefined();
    expect(updates[0]?.sources).toEqual(
      expect.arrayContaining(['rep-old', 'rep-newer']),
    );
  });

  it('skips candidates below the minimum confidence threshold', async () => {
    let inserted = 0;
    const port: UpdateGuidelinesPort = {
      async loadBySlug() {
        return null;
      },
      async insert() {
        inserted += 1;
        return { id: 'g' };
      },
      async update() {
        // ignored
      },
    };
    const report = await runUpdateGuidelinesPass(port, {
      tenantId: 't-1',
      minConfidence: 0.7,
      candidates: [
        {
          representativeId: 'r1',
          clusterSize: 2,
          failureCount: 2,
          trigger: 't',
          suggestedAction: 'a',
          confidence: 0.3,
          slug: 'rg:1',
          sourceReflexionIds: ['x'],
        },
      ],
    });
    expect(report.skippedBelowConfidence).toBe(1);
    expect(inserted).toBe(0);
  });

  it('composeBody phrases as "When …, …."', () => {
    expect(
      composeBody({
        representativeId: 'r',
        clusterSize: 1,
        failureCount: 1,
        trigger: 'Assumed Unit 4B',
        suggestedAction: 'ask before fuzzy-matching',
        confidence: 0.9,
        slug: 'rg:x',
        sourceReflexionIds: [],
      }),
    ).toMatch(/^When assumed unit 4b, ask before fuzzy-matching\.$/);
  });

  it('mergeSourceIds dedupes and caps at 50', () => {
    const big = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const merged = mergeSourceIds(['id-0'], big);
    expect(merged).toHaveLength(50);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pass 4
// ─────────────────────────────────────────────────────────────────────

describe('pass-4 prune-stale', () => {
  it('effectiveMaxAgeDays extends the cutoff for high importance', () => {
    expect(effectiveMaxAgeDays(0, 30)).toBe(30);
    expect(effectiveMaxAgeDays(0.5, 30)).toBe(60);
    expect(effectiveMaxAgeDays(1, 30)).toBe(90);
  });

  it('shouldPrune respects importance-adjusted cutoff', () => {
    const now = Date.parse('2026-05-22T00:00:00Z');
    const oldLowImportance = {
      importance: 0,
      recordedAt: new Date(now - 31 * DAY_MS).toISOString(),
    };
    const oldHighImportance = {
      importance: 1,
      recordedAt: new Date(now - 31 * DAY_MS).toISOString(),
    };
    expect(
      shouldPrune({ row: oldLowImportance, baseMaxAgeDays: 30, nowMs: now }),
    ).toBe(true);
    expect(
      shouldPrune({ row: oldHighImportance, baseMaxAgeDays: 30, nowMs: now }),
    ).toBe(false);
  });

  it('soft-prunes rows past cutoff and clears dangling cluster_ids', async () => {
    const now = Date.parse('2026-05-22T00:00:00Z');
    const candidates = [
      {
        id: 'r-old',
        importance: 0,
        recordedAt: new Date(now - 60 * DAY_MS).toISOString(),
        clusterId: null,
      },
      {
        id: 'r-dup',
        importance: 0.2,
        recordedAt: new Date(now - 5 * DAY_MS).toISOString(),
        clusterId: 'r-old',
      },
    ];
    const pruned: string[] = [];
    const cleared: string[] = [];
    const port: PruneStalePort = {
      async loadCandidates() {
        return candidates;
      },
      async markPruned(args) {
        pruned.push(args.rowId);
      },
      async isRowPrunedOrMissing(args) {
        return pruned.includes(args.rowId);
      },
      async clearClusterId(args) {
        cleared.push(args.rowId);
      },
    };
    const report = await runPruneStalePass(port, {
      tenantId: 't-1',
      baseMaxAgeDays: 30,
      nowMs: now,
    });
    expect(pruned).toEqual(['r-old']);
    expect(cleared).toEqual(['r-dup']);
    expect(report.pruned).toBe(1);
    expect(report.clusterIdsCleared).toBe(1);
  });

  it('returns "no stale candidates" when port returns empty', async () => {
    const port: PruneStalePort = {
      async loadCandidates() {
        return [];
      },
      async markPruned() {
        // ignored
      },
      async isRowPrunedOrMissing() {
        return false;
      },
      async clearClusterId() {
        // ignored
      },
    };
    const report = await runPruneStalePass(port, { tenantId: 't-1' });
    expect(report.pruned).toBe(0);
    expect(report.notes).toMatch(/no stale candidates/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Orchestrator integration
// ─────────────────────────────────────────────────────────────────────

describe('runNightlySleep — integration', () => {
  it('sequences passes 1→2→3→4 and aggregates a report', async () => {
    const rep = mkRow({
      id: 'rep',
      reflection:
        'Lessons:\n- I assumed lease anniversary 1st but next time ask the tenant',
      outcome: 'failure',
      importance: 0.6,
      recordedAt: new Date().toISOString(),
    });
    const dup = mkRow({
      id: 'dup',
      reflection:
        'I assumed lease anniversary 1st but next time confirm with tenant',
      outcome: 'failure',
      importance: 0.4,
      recordedAt: new Date(Date.now() - 1000).toISOString(),
    });

    const updates: Array<{ rowId: string; clusterId: string | null }> = [];
    const inserts: Array<{ slug: string }> = [];
    const pruned: string[] = [];
    const ports: NightlySleepPorts = {
      dedupe: {
        async loadRecent() {
          return [rep, dup];
        },
        async updateClusterId(args) {
          updates.push({ rowId: args.rowId, clusterId: args.clusterId });
          // After write, simulate that the cluster_id is reflected.
          if (args.rowId === 'dup' && args.clusterId === 'rep') {
            (dup as { -readonly [K in keyof LoadedReflexion]: LoadedReflexion[K] }).clusterId = 'rep';
          }
        },
      },
      extract: {
        async loadActiveRepresentatives() {
          return [rep];
        },
        async loadClusterMembers() {
          return [rep, dup];
        },
      },
      guidelines: {
        async loadBySlug() {
          return null;
        },
        async insert(args) {
          inserts.push({ slug: args.slug });
          return { id: 'g-new' };
        },
        async update() {
          // ignored
        },
      },
      prune: {
        async loadCandidates() {
          return [];
        },
        async markPruned(args) {
          pruned.push(args.rowId);
        },
        async isRowPrunedOrMissing() {
          return false;
        },
        async clearClusterId() {
          // ignored
        },
      },
    };

    const report = await runNightlySleep(ports, { tenantId: 't-1' });
    expect(report.aborted).toBe(false);
    expect(report.pass1?.duplicatesLinked).toBe(1);
    expect(report.pass2?.candidates.length).toBe(1);
    expect(report.pass3?.inserted).toBe(1);
    expect(report.pass4?.pruned).toBe(0);
    expect(report.errors).toEqual([]);
    // Insert slug must match the pass-2 candidate slug.
    expect(inserts[0]?.slug).toBe(report.pass2?.candidates[0]?.slug);
    // Dup got linked to rep.
    expect(updates.some((u) => u.rowId === 'dup' && u.clusterId === 'rep')).toBe(
      true,
    );
  });

  it('returns aborted=true when signal fires before pass-1', async () => {
    const controller = new AbortController();
    controller.abort();
    const ports: NightlySleepPorts = {
      dedupe: {
        async loadRecent() {
          throw new Error('should not be called');
        },
        async updateClusterId() {
          // ignored
        },
      },
      extract: {
        async loadActiveRepresentatives() {
          throw new Error('should not be called');
        },
        async loadClusterMembers() {
          throw new Error('should not be called');
        },
      },
      guidelines: {
        async loadBySlug() {
          throw new Error('should not be called');
        },
        async insert() {
          throw new Error('should not be called');
        },
        async update() {
          throw new Error('should not be called');
        },
      },
      prune: {
        async loadCandidates() {
          throw new Error('should not be called');
        },
        async markPruned() {
          // ignored
        },
        async isRowPrunedOrMissing() {
          return false;
        },
        async clearClusterId() {
          // ignored
        },
      },
    };
    const report = await runNightlySleep(ports, {
      tenantId: 't-1',
      abortSignal: controller.signal,
    });
    expect(report.aborted).toBe(true);
    expect(report.errors.some((e) => /aborted/i.test(e))).toBe(true);
  });

  it('returns "skipped" report when tenantId missing', async () => {
    const ports: NightlySleepPorts = {
      dedupe: {
        async loadRecent() {
          throw new Error('boom');
        },
        async updateClusterId() {
          // ignored
        },
      },
      extract: {
        async loadActiveRepresentatives() {
          throw new Error('boom');
        },
        async loadClusterMembers() {
          throw new Error('boom');
        },
      },
      guidelines: {
        async loadBySlug() {
          throw new Error('boom');
        },
        async insert() {
          throw new Error('boom');
        },
        async update() {
          throw new Error('boom');
        },
      },
      prune: {
        async loadCandidates() {
          throw new Error('boom');
        },
        async markPruned() {
          // ignored
        },
        async isRowPrunedOrMissing() {
          return false;
        },
        async clearClusterId() {
          // ignored
        },
      },
    };
    const report = await runNightlySleep(ports, { tenantId: '' });
    expect(report.errors).toEqual(['skipped: missing tenantId']);
    expect(report.pass1).toBeNull();
  });
});
