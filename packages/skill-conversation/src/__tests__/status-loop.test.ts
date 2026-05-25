/**
 * Status loop — registry + lifecycle transitions + chat surface.
 */

import { describe, expect, it } from 'vitest';
import { InMemorySkillRegistry } from '../registry/in-memory.js';
import {
  buildLifecycleAck,
  deleteSkill,
  getSkillStatus,
  pauseSkill,
  recordRun,
  resumeSkill,
  SkillLifecycleError,
  SkillNotFoundError,
  summariseEntry,
  summariseList,
} from '../status/index.js';
import type { SkillRegistryEntry } from '../types.js';

function makeEntry(overrides: Partial<SkillRegistryEntry> = {}): SkillRegistryEntry {
  const base: SkillRegistryEntry = {
    id: 'skl_test_0001',
    scope: 'owner-customer',
    tenantId: 'tenant-001',
    authorActorId: 'actor-001',
    anchor: Object.freeze({
      conversationId: 'conv-abc',
      messageId: 'msg-1',
      createdAt: '2026-05-19T07:00:00.000Z',
      originalNL: 'Every Monday send me a brief.',
    }),
    aopName: 'weekly-brief',
    aopVersion: '0.1.0',
    lifecycle: 'active',
    summary: 'Weekly brief',
    history: Object.freeze([
      { at: '2026-05-19T07:00:00.000Z', kind: 'created' as const },
      { at: '2026-05-19T07:00:00.000Z', kind: 'activated' as const },
    ]),
    cronHandle: 'cron:weekly-brief:0 7 * * 1',
    runCount: 0,
    lastRun: null,
  };
  return Object.freeze({ ...base, ...overrides });
}

describe('InMemorySkillRegistry', () => {
  it('saves and loads an entry by id', async () => {
    const reg = new InMemorySkillRegistry();
    const entry = makeEntry();
    await reg.save(entry);
    const loaded = await reg.load(entry.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(entry.id);
  });

  it('returns null for unknown id', async () => {
    const reg = new InMemorySkillRegistry();
    expect(await reg.load('missing')).toBeNull();
  });

  it('throws on duplicate save', async () => {
    const reg = new InMemorySkillRegistry();
    const entry = makeEntry();
    await reg.save(entry);
    await expect(reg.save(entry)).rejects.toThrow(/duplicate id/);
  });

  it('listByOwner filters by tenantId for owner-customer', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ id: 'a', tenantId: 'tenant-1' }));
    await reg.save(makeEntry({ id: 'b', tenantId: 'tenant-2' }));
    const t1 = await reg.listByOwner({ scope: 'owner-customer', tenantId: 'tenant-1' });
    expect(t1.map((e) => e.id)).toEqual(['a']);
  });

  it('listByOwner includes platform-wide for internal-admin', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ id: 'p', scope: 'internal-admin', tenantId: null }));
    await reg.save(makeEntry({ id: 't', scope: 'internal-admin', tenantId: 'tenant-X' }));
    const list = await reg.listByOwner({ scope: 'internal-admin', tenantId: 'tenant-X' });
    const ids = list.map((e) => e.id).sort();
    expect(ids).toEqual(['p', 't']);
  });

  it('listByOwner excludes deleted entries', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ id: 'a' }));
    await reg.save(makeEntry({ id: 'b', lifecycle: 'deleted' }));
    const list = await reg.listByOwner({ scope: 'owner-customer', tenantId: 'tenant-001' });
    expect(list.map((e) => e.id)).toEqual(['a']);
  });

  it('update replaces the entry atomically', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const updated = await reg.update('skl_test_0001', (e) => ({ ...e, summary: 'Updated' }));
    expect(updated?.summary).toBe('Updated');
    const loaded = await reg.load('skl_test_0001');
    expect(loaded?.summary).toBe('Updated');
  });

  it('update returns null for unknown id', async () => {
    const reg = new InMemorySkillRegistry();
    const result = await reg.update('nope', (e) => e);
    expect(result).toBeNull();
  });

  it('update rejects an id change', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    await expect(
      reg.update('skl_test_0001', (e) => ({ ...e, id: 'different' })),
    ).rejects.toThrow(/must not change id/);
  });

  it('entries are deeply frozen after save', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const loaded = await reg.load('skl_test_0001');
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.history)).toBe(true);
  });
});

describe('getSkillStatus', () => {
  it('returns the entry', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const entry = await getSkillStatus(reg, 'skl_test_0001');
    expect(entry.id).toBe('skl_test_0001');
  });

  it('throws SkillNotFoundError for unknown id', async () => {
    const reg = new InMemorySkillRegistry();
    await expect(getSkillStatus(reg, 'missing')).rejects.toBeInstanceOf(SkillNotFoundError);
  });
});

describe('pauseSkill', () => {
  it('transitions active → paused and records the event', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const next = await pauseSkill(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T08:00:00.000Z',
      reason: 'tenant-paused',
    });
    expect(next.lifecycle).toBe('paused');
    const lastEvent = next.history[next.history.length - 1]!;
    expect(lastEvent.kind).toBe('paused');
    expect(lastEvent.note).toBe('tenant-paused');
  });

  it('rejects double-pause', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ lifecycle: 'paused' }));
    await expect(
      pauseSkill(reg, 'skl_test_0001', { nowIso: '2026-05-19T08:00:00.000Z' }),
    ).rejects.toBeInstanceOf(SkillLifecycleError);
  });

  it('throws SkillNotFoundError for unknown id', async () => {
    const reg = new InMemorySkillRegistry();
    await expect(
      pauseSkill(reg, 'missing', { nowIso: '2026-05-19T08:00:00.000Z' }),
    ).rejects.toBeInstanceOf(SkillNotFoundError);
  });
});

describe('resumeSkill', () => {
  it('transitions paused → active', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ lifecycle: 'paused' }));
    const next = await resumeSkill(reg, 'skl_test_0001', { nowIso: '2026-05-19T09:00:00.000Z' });
    expect(next.lifecycle).toBe('active');
  });

  it('rejects resume from a non-paused state', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    await expect(
      resumeSkill(reg, 'skl_test_0001', { nowIso: '2026-05-19T09:00:00.000Z' }),
    ).rejects.toBeInstanceOf(SkillLifecycleError);
  });
});

describe('deleteSkill', () => {
  it('marks the skill as deleted', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const next = await deleteSkill(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T10:00:00.000Z',
    });
    expect(next.lifecycle).toBe('deleted');
  });

  it('hides the skill from listByOwner after delete', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    await deleteSkill(reg, 'skl_test_0001', { nowIso: '2026-05-19T10:00:00.000Z' });
    const list = await reg.listByOwner({ scope: 'owner-customer', tenantId: 'tenant-001' });
    expect(list.length).toBe(0);
  });

  it('rejects re-delete', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry({ lifecycle: 'deleted' }));
    await expect(
      deleteSkill(reg, 'skl_test_0001', { nowIso: '2026-05-19T10:00:00.000Z' }),
    ).rejects.toBeInstanceOf(SkillLifecycleError);
  });
});

describe('recordRun', () => {
  it('appends a run-started event and increments runCount', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    const next = await recordRun(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T07:00:00.000Z',
      outcome: 'started',
    });
    expect(next.runCount).toBe(1);
    expect(next.lastRun?.outcome).toBe('in-progress');
  });

  it('records a run-completed event with lastRun', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    await recordRun(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T07:00:00.000Z',
      outcome: 'started',
    });
    const next = await recordRun(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T07:05:00.000Z',
      outcome: 'completed',
      note: 'opened',
    });
    expect(next.lastRun?.outcome).toBe('completed');
    expect(next.lastRun?.note).toBe('opened');
  });

  it('records a run-failed event without incrementing runCount past the started count', async () => {
    const reg = new InMemorySkillRegistry();
    await reg.save(makeEntry());
    await recordRun(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T07:00:00.000Z',
      outcome: 'started',
    });
    const next = await recordRun(reg, 'skl_test_0001', {
      nowIso: '2026-05-19T07:05:00.000Z',
      outcome: 'failed',
      note: 'tool not found',
    });
    expect(next.runCount).toBe(1);
    expect(next.lastRun?.outcome).toBe('failed');
  });
});

describe('chat surface', () => {
  it('summariseEntry shows active + cadence + has not run yet', () => {
    const s = summariseEntry(makeEntry());
    expect(s).toMatch(/is active/);
    expect(s).toMatch(/0 7 \* \* 1/);
    expect(s).toMatch(/has not run yet/);
  });

  it('summariseEntry shows paused', () => {
    const s = summariseEntry(makeEntry({ lifecycle: 'paused' }));
    expect(s).toMatch(/is paused/);
  });

  it('summariseEntry includes failed last-run note', () => {
    const entry = makeEntry({
      lifecycle: 'active',
      lastRun: Object.freeze({
        at: '2026-05-12T07:00:00.000Z',
        outcome: 'failed' as const,
        note: 'KRA MCP timeout',
      }),
    });
    const s = summariseEntry(entry);
    expect(s).toMatch(/FAILED/);
    expect(s).toMatch(/KRA MCP timeout/);
  });

  it('summariseList shows count + numbered items', () => {
    const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
    const s = summariseList(entries);
    expect(s).toMatch(/2 skills/);
    expect(s).toMatch(/1\./);
    expect(s).toMatch(/2\./);
  });

  it('summariseList handles empty list', () => {
    expect(summariseList([])).toMatch(/no skills set up yet/);
  });

  it('buildLifecycleAck for paused', () => {
    const ack = buildLifecycleAck({ action: 'paused', entry: makeEntry() });
    expect(ack).toMatch(/Paused/);
    expect(ack).toMatch(/resume/);
  });

  it('buildLifecycleAck for resumed', () => {
    const ack = buildLifecycleAck({ action: 'resumed', entry: makeEntry() });
    expect(ack).toMatch(/Resumed/);
  });

  it('buildLifecycleAck for deleted', () => {
    const ack = buildLifecycleAck({ action: 'deleted', entry: makeEntry() });
    expect(ack).toMatch(/Deleted/);
  });
});
