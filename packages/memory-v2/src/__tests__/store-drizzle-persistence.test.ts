/**
 * MEM-01 restart-persistence proof for the memory-v2 Drizzle stores.
 *
 * Each test writes through a FIRST store-adapter instance, then constructs a
 * SECOND, freshly-built adapter over the SAME shared backing table set
 * (`FakeTables`) and reads the data back. The second instance models the
 * gateway AFTER a process restart: a brand-new store object, zero per-instance
 * memory, reading from the durable store. The in-memory reference impls would
 * return empty here (their `Map` lives inside the closure and is lost on
 * reconstruction) — the Drizzle adapters return the persisted rows.
 *
 * `drizzle-orm`'s condition + ordering helpers are mocked so the in-memory
 * `FakeTables` can evaluate the predicates the stores build (see fake-drizzle).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const m = await import('./fake-drizzle.js');
  return {
    ...actual,
    eq: m.fakeEq,
    and: m.fakeAnd,
    like: m.fakeLike,
    sql: Object.assign(() => m.fakeMarker(), { raw: () => m.fakeMarker() }),
    desc: () => m.fakeMarker(),
    asc: () => m.fakeMarker(),
  };
});

import { createFakeDb, FakeTables } from './fake-drizzle.js';
import { createDrizzleEpisodicStore } from '../episodic/store-drizzle.js';
import { createDrizzleNarrativeStore } from '../narrative/store-drizzle.js';
import { createDrizzleProceduralStore } from '../procedural/store-drizzle.js';
import { createDrizzleReflectiveStore } from '../reflective/store-drizzle.js';
import { createDrizzleTopicFileStore } from '../topic-files/store-drizzle.js';
import { createDrizzleCohortCacheStore } from '../cohort-cache/store-drizzle.js';
import type {
  Episode,
  EpisodeFact,
  NarrativeArc,
  ProceduralSkill,
  ReflectiveNote,
  TopicFile,
  CohortCacheEntry,
} from '../types.js';

const NOW = '2026-06-08T00:00:00.000Z';

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    tenantId: 'tenant-a',
    userId: 'user-1',
    surface: 'owner_portal',
    subject: 'licence:ML-001',
    title: 'Licence renewal discussed',
    summary: 'Owner asked about ML-001 renewal window.',
    validFrom: NOW,
    validTo: null,
    recordedAt: NOW,
    embedding: [],
    tags: ['licence'],
    ...overrides,
  };
}

describe('MEM-01 — memory-v2 Drizzle stores persist across a simulated restart', () => {
  it('episodic: episode + fact survive a new store instance', async () => {
    const tables = new FakeTables();

    // ── before restart ──
    const writer = createDrizzleEpisodicStore(createFakeDb(tables));
    await writer.upsertEpisode(makeEpisode());
    const fact: EpisodeFact = {
      id: 'fact-1',
      episodeId: 'ep-1',
      subject: 'licence:ML-001',
      predicate: 'renewal_window_days',
      object: '90',
      confidence: 0.8,
      validFrom: NOW,
      validTo: null,
      recordedAt: NOW,
    };
    await writer.recordFact(fact);

    // ── after restart: brand-new adapter over the same tables ──
    const reader = createDrizzleEpisodicStore(createFakeDb(tables));
    const recalled = await reader.retrieveByRelevance({ tenantId: 'tenant-a' });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.episode.id).toBe('ep-1');
    expect(recalled[0]?.episode.title).toBe('Licence renewal discussed');

    const facts = await reader.listFactsForEpisode('ep-1');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.predicate).toBe('renewal_window_days');
    expect(facts[0]?.confidence).toBeCloseTo(0.8, 3);
  });

  it('episodic: tenant isolation holds on recall', async () => {
    const tables = new FakeTables();
    const writer = createDrizzleEpisodicStore(createFakeDb(tables));
    await writer.upsertEpisode(makeEpisode({ id: 'ep-a', tenantId: 'tenant-a' }));
    await writer.upsertEpisode(makeEpisode({ id: 'ep-b', tenantId: 'tenant-b' }));

    const reader = createDrizzleEpisodicStore(createFakeDb(tables));
    const aRows = await reader.retrieveByRelevance({ tenantId: 'tenant-a' });
    expect(aRows.map((r) => r.episode.id)).toEqual(['ep-a']);
  });

  it('narrative: arc survives a new store instance', async () => {
    const tables = new FakeTables();
    const arc: NarrativeArc = {
      id: 'arc-1',
      tenantId: 'tenant-a',
      title: 'Q2 royalty dispute',
      summary: 'Multi-episode arc about the royalty reconciliation.',
      episodeIds: ['ep-1', 'ep-2'],
      startedAt: NOW,
      endedAt: null,
      tags: ['royalty'],
      recordedAt: NOW,
    };
    await createDrizzleNarrativeStore(createFakeDb(tables)).upsertArc(arc);

    const reader = createDrizzleNarrativeStore(createFakeDb(tables));
    const arcs = await reader.listArcsForTenant('tenant-a');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.title).toBe('Q2 royalty dispute');
    expect(arcs[0]?.episodeIds).toEqual(['ep-1', 'ep-2']);
  });

  it('procedural: skill + Voyager promotion survive + accrue across instances', async () => {
    const tables = new FakeTables();
    const base: ProceduralSkill = {
      id: 'ignored',
      tenantId: 'tenant-a',
      name: 'reconcile-royalty',
      description: 'Reconcile royalty statement against ledger.',
      triggerPattern: 'royalty statement uploaded',
      actionSequence: [{ tool: 'ledger.match' }],
      observedCount: 1,
      successRate: 1,
      promoted: false,
      lastSeenAt: NOW,
      createdAt: NOW,
    };

    // Observe the skill twice through two SEPARATE adapter instances. The
    // second observe must see the first's persisted count (1 → 2), proving the
    // count accrues durably rather than resetting per instance.
    await createDrizzleProceduralStore(createFakeDb(tables)).recordSkill(base);
    const second = await createDrizzleProceduralStore(
      createFakeDb(tables),
    ).recordSkill(base);
    expect(second.observedCount).toBe(2);
    expect(second.promoted).toBe(false);

    // Third observe crosses the promotion threshold (3) — through yet another
    // fresh instance.
    const third = await createDrizzleProceduralStore(
      createFakeDb(tables),
    ).recordSkill(base);
    expect(third.observedCount).toBe(3);
    expect(third.promoted).toBe(true);

    const reader = createDrizzleProceduralStore(createFakeDb(tables));
    const promoted = await reader.getPromotedSkills('tenant-a');
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.name).toBe('reconcile-royalty');
    const found = await reader.findByName('tenant-a', 'reconcile-royalty');
    expect(found?.observedCount).toBe(3);
  });

  it('reflective: latest note survives a new store instance', async () => {
    const tables = new FakeTables();
    const note: ReflectiveNote = {
      id: 'note-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      insight: 'Owner prefers concise royalty summaries.',
      adjustments: ['Lead with the number, then the why.'],
      periodStart: NOW,
      periodEnd: NOW,
      selfScore: 0.7,
      createdAt: NOW,
    };
    await createDrizzleReflectiveStore(createFakeDb(tables)).upsertNote(note);

    const reader = createDrizzleReflectiveStore(createFakeDb(tables));
    const latest = await reader.getLatestForTenant('tenant-a');
    expect(latest?.insight).toBe('Owner prefers concise royalty summaries.');
    expect(latest?.selfScore).toBeCloseTo(0.7, 3);
    expect(latest?.adjustments).toEqual(['Lead with the number, then the why.']);
  });

  it('topic-files: topic shard survives a new store instance', async () => {
    const tables = new FakeTables();
    const topic: TopicFile = {
      id: 'ignored',
      tenantId: 'tenant-a',
      topic: 'licence:ML-001',
      summary: 'Everything known about ML-001.',
      facts: [],
      episodeIds: ['ep-1'],
      updatedAt: NOW,
      createdAt: NOW,
    };
    await createDrizzleTopicFileStore(createFakeDb(tables)).upsertTopic(topic);

    const reader = createDrizzleTopicFileStore(createFakeDb(tables));
    const got = await reader.getByTopic('tenant-a', 'licence:ML-001');
    expect(got?.summary).toBe('Everything known about ML-001.');
    expect(got?.episodeIds).toEqual(['ep-1']);
  });

  it('cohort-cache: entry survives a new instance; expiry + invalidate honored', async () => {
    const tables = new FakeTables();
    const entry: CohortCacheEntry<{ rate: number }> = {
      tenantId: 'tenant-a',
      jurisdiction: 'TZ',
      key: 'royalty-rate-table',
      value: { rate: 0.06 },
      recordedAt: NOW,
      expiresAt: null,
    };
    await createDrizzleCohortCacheStore(createFakeDb(tables)).set(entry);

    const reader = createDrizzleCohortCacheStore(createFakeDb(tables));
    const got = await reader.get<{ rate: number }>(
      'tenant-a',
      'TZ',
      'royalty-rate-table',
    );
    expect(got?.value).toEqual({ rate: 0.06 });
    expect(got?.jurisdiction).toBe('TZ');

    // Expired entry returns null + is evicted.
    await createDrizzleCohortCacheStore(createFakeDb(tables)).set({
      ...entry,
      key: 'stale',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const stale = await reader.get('tenant-a', 'TZ', 'stale');
    expect(stale).toBeNull();

    // Invalidate by prefix removes the matching entry.
    await reader.invalidate('tenant-a', 'TZ', 'royalty-');
    const afterInvalidate = await reader.get(
      'tenant-a',
      'TZ',
      'royalty-rate-table',
    );
    expect(afterInvalidate).toBeNull();
  });
});
