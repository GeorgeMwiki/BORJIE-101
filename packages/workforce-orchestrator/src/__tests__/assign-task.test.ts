import { describe, expect, it } from 'vitest';
import {
  AssignTaskInputSchema,
  assignTask,
  buildFollowupSchedule,
  deriveRiskTier,
  pickCadence,
} from '../assign-task.js';
import { makeFixture, seedEmployee } from './fixtures.js';

describe('AssignTaskInputSchema', () => {
  it('rejects empty title', () => {
    expect(() =>
      AssignTaskInputSchema.parse({
        tenantId: 't1',
        title: '',
        description: 'x',
        assignedEmployeeId: 'e1',
        assignedByUserId: 'u1',
      })
    ).toThrow();
  });

  it('defaults priority and riskHint', () => {
    const parsed = AssignTaskInputSchema.parse({
      tenantId: 't1',
      title: 'fix',
      description: 'x',
      assignedEmployeeId: 'e1',
      assignedByUserId: 'u1',
    });
    expect(parsed.priority).toBe('medium');
    expect(parsed.riskHint).toBe('LOW');
  });
});

describe('deriveRiskTier', () => {
  it('escalates to SOVEREIGN on regulator keyword', () => {
    const t = deriveRiskTier({
      hint: 'LOW',
      title: 'Routine inspection',
      description: 'fraud report from regulator pending',
      priority: 'medium',
    });
    expect(t).toBe('SOVEREIGN');
  });

  it('escalates to HIGH on a mining/treasury keyword (royalty dispute)', () => {
    const t = deriveRiskTier({
      hint: 'LOW',
      title: 'Notice prep',
      description: 'resolve the royalty payment dispute with the off-taker',
      priority: 'medium',
    });
    expect(t).toBe('HIGH');
  });

  it('no longer escalates on the dropped property-era terms (evict/eviction)', () => {
    const t = deriveRiskTier({
      hint: 'LOW',
      title: 'Notice prep',
      description: 'process the eviction paperwork',
      priority: 'medium',
    });
    expect(t).toBe('LOW');
  });

  it('escalates a SWAHILI payment/licence task to HIGH (bilingual parity)', () => {
    expect(
      deriveRiskTier({
        hint: 'LOW',
        title: 'Fanya malipo ya mrabaha',
        description: 'Kamilisha malipo ya leseni kabla ya mwisho wa mwezi',
        priority: 'medium',
      }),
    ).toBe('HIGH');
    expect(
      deriveRiskTier({
        hint: 'LOW',
        title: 'Tatua mgogoro wa wafanyakazi',
        description: 'Mgogoro umefika mahakamani',
        priority: 'medium',
      }),
    ).toBe('HIGH');
  });

  it('treats the lexicon as DATA: an injected lexicon replaces the default', () => {
    const lexicon = { high: ['dragline'], sovereign: ['cyanide spill'] };
    // The custom HIGH term fires…
    expect(
      deriveRiskTier({
        hint: 'LOW',
        title: 'Move the dragline',
        description: 'reposition before the blast window',
        priority: 'medium',
        lexicon,
      }),
    ).toBe('HIGH');
    // …the custom SOVEREIGN term fires…
    expect(
      deriveRiskTier({
        hint: 'LOW',
        title: 'Contain the cyanide spill',
        description: 'isolate pond 3',
        priority: 'medium',
        lexicon,
      }),
    ).toBe('SOVEREIGN');
    // …and the DEFAULT terms do NOT (no hardcoded keywords in the engine).
    expect(
      deriveRiskTier({
        hint: 'LOW',
        title: 'Process the payment',
        description: 'royalty payment to the regulator',
        priority: 'medium',
        lexicon,
      }),
    ).toBe('LOW');
  });

  it('bumps urgent low → medium', () => {
    const t = deriveRiskTier({
      hint: 'LOW',
      title: 'fix tap',
      description: 'tap leaking',
      priority: 'urgent',
    });
    expect(t).toBe('MEDIUM');
  });

  it('never downgrades the caller hint', () => {
    const t = deriveRiskTier({
      hint: 'HIGH',
      title: 'random',
      description: 'mundane',
      priority: 'low',
    });
    expect(t).toBe('HIGH');
  });

  it('keeps LOW when no triggers', () => {
    const t = deriveRiskTier({
      hint: 'LOW',
      title: 'routine',
      description: 'normal maintenance',
      priority: 'medium',
    });
    expect(t).toBe('LOW');
  });
});

describe('pickCadence', () => {
  const now = Date.parse('2026-05-22T00:00:00Z');

  it('returns daily for SOVEREIGN', () => {
    expect(
      pickCadence({ riskTier: 'SOVEREIGN', priority: 'low', dueAtMs: null, nowMs: now })
    ).toEqual(['daily']);
  });

  it('returns daily for urgent', () => {
    expect(
      pickCadence({ riskTier: 'LOW', priority: 'urgent', dueAtMs: null, nowMs: now })
    ).toEqual(['daily']);
  });

  it('returns mid_week + end_of_week when no due date', () => {
    expect(
      pickCadence({ riskTier: 'LOW', priority: 'medium', dueAtMs: null, nowMs: now })
    ).toEqual(['mid_week', 'end_of_week']);
  });

  it('returns one_shot when due within 24h', () => {
    expect(
      pickCadence({
        riskTier: 'LOW',
        priority: 'medium',
        dueAtMs: now + 12 * 3_600_000,
        nowMs: now,
      })
    ).toEqual(['one_shot']);
  });

  it('returns daily when due within 72h', () => {
    expect(
      pickCadence({
        riskTier: 'LOW',
        priority: 'medium',
        dueAtMs: now + 48 * 3_600_000,
        nowMs: now,
      })
    ).toEqual(['daily']);
  });

  it('returns weekly cadence for longer horizons', () => {
    expect(
      pickCadence({
        riskTier: 'LOW',
        priority: 'medium',
        dueAtMs: now + 30 * 24 * 3_600_000,
        nowMs: now,
      })
    ).toEqual(['mid_week', 'end_of_week']);
  });
});

describe('buildFollowupSchedule', () => {
  const now = Date.parse('2026-05-22T00:00:00Z'); // Friday UTC

  it('emits 5 daily slots when no due cap', () => {
    const out = buildFollowupSchedule({
      cadenceKinds: ['daily'],
      nowMs: now,
      dueAtMs: null,
    });
    expect(out).toHaveLength(5);
    expect(out.every((s) => s.cadenceKind === 'daily')).toBe(true);
  });

  it('caps daily slots at the due-date', () => {
    const out = buildFollowupSchedule({
      cadenceKinds: ['daily'],
      nowMs: now,
      dueAtMs: now + 2 * 24 * 3_600_000,
    });
    expect(out).toHaveLength(2);
  });

  it('mid_week slot lands on a Wednesday in the future', () => {
    const out = buildFollowupSchedule({
      cadenceKinds: ['mid_week'],
      nowMs: now,
      dueAtMs: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.scheduledAt.getUTCDay()).toBe(3);
    expect(out[0]!.scheduledAt.getTime()).toBeGreaterThan(now);
  });

  it('end_of_week slot lands on Friday', () => {
    const out = buildFollowupSchedule({
      cadenceKinds: ['end_of_week'],
      nowMs: now,
      dueAtMs: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.scheduledAt.getUTCDay()).toBe(5);
  });

  it('one_shot lands ~4h before due_at if provided', () => {
    const dueMs = now + 48 * 3_600_000;
    const out = buildFollowupSchedule({
      cadenceKinds: ['one_shot'],
      nowMs: now,
      dueAtMs: dueMs,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.scheduledAt.getTime()).toBeLessThan(dueMs);
    expect(out[0]!.scheduledAt.getTime()).toBeGreaterThan(now);
  });

  it('one_shot lands ~1d ahead when no due_at', () => {
    const out = buildFollowupSchedule({
      cadenceKinds: ['one_shot'],
      nowMs: now,
      dueAtMs: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.scheduledAt.getTime()).toBeGreaterThan(now);
  });
});

describe('assignTask risk gating (bilingual lexicon)', () => {
  it('a SWAHILI payment task derives HIGH and yields hitlRequired=true', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, {
      id: 'emp-sw',
      tenantId: 't1',
      personEntityId: 'p-sw',
    });

    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'Fanya malipo ya mrabaha kwa serikali',
      description: 'Kamilisha malipo ya leseni kabla ya mwisho wa mwezi',
      assignedEmployeeId: 'emp-sw',
      assignedByUserId: 'u-md',
      priority: 'medium',
    });

    expect(r.assignment.riskTier).toBe('HIGH');
    expect(r.assignment.hitlRequired).toBe(true);
  });

  it('threads an injected riskLexicon through the input boundary', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, {
      id: 'emp-lx',
      tenantId: 't1',
      personEntityId: 'p-lx',
    });

    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'Move the dragline',
      description: 'reposition before the blast window',
      assignedEmployeeId: 'emp-lx',
      assignedByUserId: 'u-md',
      priority: 'medium',
      riskLexicon: { high: ['dragline'], sovereign: [] },
    });

    expect(r.assignment.riskTier).toBe('HIGH');
    expect(r.assignment.hitlRequired).toBe(true);
  });
});

describe('assignTask happy path', () => {
  it('writes an assignment, schedules followups, sends notification', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, {
      id: 'emp-1',
      tenantId: 't1',
      personEntityId: 'p-1',
    });

    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'Inspect unit 3B',
      description: 'condition survey before re-lease',
      assignedEmployeeId: 'emp-1',
      assignedByUserId: 'u-mgr',
      priority: 'medium',
      dueAt: new Date(Date.parse('2026-05-25T17:00:00Z')).toISOString(),
    });

    expect(r.assignment.status).toBe('pending');
    expect(r.assignment.tenantId).toBe('t1');
    expect(r.assignment.auditChainId).toBeTruthy();
    expect(r.followupIds.length).toBeGreaterThan(0);
    expect(r.notificationDelivered).toBe(true);
    expect(fx.audit.appended).toHaveLength(1);
    expect(fx.audit.appended[0]!.action).toBe('workforce.assign_task');
  });

  it('refuses an unknown employee', async () => {
    const fx = makeFixture();
    await expect(
      assignTask(fx.deps, {
        tenantId: 't1',
        title: 'x',
        description: 'x',
        assignedEmployeeId: 'ghost',
        assignedByUserId: 'u1',
      })
    ).rejects.toThrow();
  });

  it('refuses an inactive employee', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, {
      id: 'emp-2',
      tenantId: 't1',
      personEntityId: 'p-2',
      status: 'on_leave',
    });
    await expect(
      assignTask(fx.deps, {
        tenantId: 't1',
        title: 'x',
        description: 'x',
        assignedEmployeeId: 'emp-2',
        assignedByUserId: 'u1',
      })
    ).rejects.toThrow();
  });

  it('flags HITL when riskHint=HIGH', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p-1' });
    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'standard',
      description: 'standard task',
      assignedEmployeeId: 'emp-1',
      assignedByUserId: 'u-mgr',
      riskHint: 'HIGH',
    });
    expect(r.assignment.hitlRequired).toBe(true);
    expect(r.assignment.riskTier).toBe('HIGH');
  });

  it('respects explicit cadenceKinds override', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p-1' });
    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'x',
      description: 'x',
      assignedEmployeeId: 'emp-1',
      assignedByUserId: 'u-mgr',
      cadenceKinds: ['one_shot'],
    });
    expect(r.followupIds).toHaveLength(1);
  });

  it('does not blow up if channel adapter fails', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p-1' });
    // Replace channel with failing adapter.
    (fx.deps as { channel: { send: () => Promise<never> } }).channel = {
      send: () => {
        throw new Error('nope');
      },
    };
    const r = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'x',
      description: 'x',
      assignedEmployeeId: 'emp-1',
      assignedByUserId: 'u-mgr',
    });
    expect(r.notificationDelivered).toBe(false);
  });
});
