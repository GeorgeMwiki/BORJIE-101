import { describe, it, expect } from 'vitest';
import {
  clockToMinutes,
  isInQuietHours,
  resolveChannel,
  runSchedulerOnce,
  type SchedulerDeps,
} from '../scheduler/followup-scheduler.js';
import { createInMemoryCandidateRepository } from '../repositories/candidate.js';
import { createInMemoryPreferencesRepository } from '../repositories/preferences.js';
import { createInMemoryAuditChain } from '../repositories/audit.js';
import { createInAppDispatcher } from '../channels/inapp.js';
import { createEmailDispatcher } from '../channels/email.js';
import type {
  ChannelDispatcher,
  FollowupCandidate,
  FollowupChannel,
  FollowupPreferences,
} from '../types.js';

function makeCandidate(
  overrides: Partial<FollowupCandidate> = {},
): FollowupCandidate {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: 't1',
    user_id: 'u1',
    source: 'regulator',
    payload: { text: 'TRA Tumemadini Q2 filing window opens Friday.' },
    priority: 0.9,
    channel: 'inapp',
    scheduled_for: '2026-05-26T08:00:00.000Z',
    status: 'pending',
    sent_at: null,
    audit_hash: '',
    created_at: '2026-05-26T07:00:00.000Z',
    critical: false,
    ...overrides,
  };
}

function makePrefs(
  overrides: Partial<FollowupPreferences> = {},
): FollowupPreferences {
  return {
    tenant_id: 't1',
    user_id: 'u1',
    allowed_channels: ['inapp', 'email', 'whatsapp'],
    quiet_hours_start: '22:00:00',
    quiet_hours_end: '07:00:00',
    max_per_day: 5,
    timezone: 'UTC',
    ...overrides,
  };
}

async function buildDeps(now: Date): Promise<SchedulerDeps> {
  const candidateRepo = createInMemoryCandidateRepository();
  const prefsRepo = createInMemoryPreferencesRepository();
  const audit = createInMemoryAuditChain();
  const dispatchers = new Map<FollowupChannel, ChannelDispatcher>([
    ['inapp', createInAppDispatcher({ clock: () => now })],
    ['email', createEmailDispatcher({ clock: () => now })],
  ]);
  return { candidateRepo, prefsRepo, dispatchers, audit, clock: () => now };
}

describe('clock + quiet-hours utilities', () => {
  it('clockToMinutes handles HH:MM:SS and HH:MM', () => {
    expect(clockToMinutes('22:00:00')).toBe(22 * 60);
    expect(clockToMinutes('07:30')).toBe(7 * 60 + 30);
    expect(clockToMinutes('00:00:00')).toBe(0);
  });

  it('isInQuietHours wraps midnight correctly', () => {
    const start = clockToMinutes('22:00:00');
    const end = clockToMinutes('07:00:00');
    // 23:00 should fall inside (post-midnight wrap).
    expect(isInQuietHours(23 * 60, start, end)).toBe(true);
    // 03:00 (next day, pre-end) should also fall inside.
    expect(isInQuietHours(3 * 60, start, end)).toBe(true);
    // 12:00 should fall outside.
    expect(isInQuietHours(12 * 60, start, end)).toBe(false);
    // Boundary: exactly at end means OUT.
    expect(isInQuietHours(7 * 60, start, end)).toBe(false);
  });
});

describe('resolveChannel — channel routing + opt-out', () => {
  it('returns the preferred channel when allowed', () => {
    const c = makeCandidate({ channel: 'email' });
    const p = makePrefs({ allowed_channels: ['inapp', 'email'] });
    expect(resolveChannel(c, p)).toBe('email');
  });

  it('falls back to email when whatsapp is opted out', () => {
    const c = makeCandidate({ channel: 'whatsapp' });
    const p = makePrefs({ allowed_channels: ['inapp', 'email'] });
    expect(resolveChannel(c, p)).toBe('email');
  });

  it('falls back to inapp when both whatsapp and email are opted out', () => {
    const c = makeCandidate({ channel: 'whatsapp' });
    const p = makePrefs({ allowed_channels: ['inapp'] });
    expect(resolveChannel(c, p)).toBe('inapp');
  });

  it('returns null when the user has opted out of every channel', () => {
    const c = makeCandidate({ channel: 'whatsapp' });
    const p = makePrefs({ allowed_channels: [] });
    expect(resolveChannel(c, p)).toBeNull();
  });
});

describe('runSchedulerOnce — full tick semantics', () => {
  it('dispatches a due candidate via the in-app channel and records audit', async () => {
    const now = new Date('2026-05-26T12:00:00.000Z'); // mid-day, not quiet
    const deps = await buildDeps(now);
    const audit = createInMemoryAuditChain();
    const auditingDeps: SchedulerDeps = { ...deps, audit };
    await deps.prefsRepo.upsert(makePrefs());
    await deps.candidateRepo.insert(
      makeCandidate({
        scheduled_for: '2026-05-26T08:00:00.000Z',
      }),
    );

    const result = await runSchedulerOnce(auditingDeps, 't1');

    expect(result.dispatched).toHaveLength(1);
    const summary = result.dispatched[0];
    expect(summary).toBeDefined();
    if (summary === undefined) throw new Error('summary undefined');
    expect(summary.channel).toBe('inapp');
    expect(summary.result.delivered).toBe(true);
    expect(result.suppressed).toHaveLength(0);
    expect(audit.history()).toHaveLength(1);
  });

  it('suppresses non-critical candidates during quiet hours', async () => {
    // 23:00 UTC, user tz UTC, quiet 22:00→07:00.
    const now = new Date('2026-05-26T23:00:00.000Z');
    const deps = await buildDeps(now);
    await deps.prefsRepo.upsert(makePrefs());
    await deps.candidateRepo.insert(
      makeCandidate({ scheduled_for: now.toISOString() }),
    );

    const result = await runSchedulerOnce(deps, 't1');

    expect(result.dispatched).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    const sup = result.suppressed[0];
    expect(sup).toBeDefined();
    if (sup === undefined) throw new Error('sup undefined');
    expect(sup.reason).toBe('quiet_hours');
  });

  it('bypasses quiet hours when the candidate is critical', async () => {
    const now = new Date('2026-05-26T23:00:00.000Z');
    const deps = await buildDeps(now);
    await deps.prefsRepo.upsert(makePrefs());
    await deps.candidateRepo.insert(
      makeCandidate({ critical: true, scheduled_for: now.toISOString() }),
    );

    const result = await runSchedulerOnce(deps, 't1');

    expect(result.dispatched).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it('suppresses when daily cap is reached, but bypasses on critical', async () => {
    const now = new Date('2026-05-26T12:00:00.000Z');
    const deps = await buildDeps(now);
    await deps.prefsRepo.upsert(makePrefs({ max_per_day: 1 }));

    // Pre-seed one already-sent candidate today.
    await deps.candidateRepo.insert(
      makeCandidate({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'sent',
        sent_at: '2026-05-26T09:00:00.000Z',
      }),
    );
    // New due non-critical candidate — should suppress.
    await deps.candidateRepo.insert(
      makeCandidate({
        id: '00000000-0000-0000-0000-000000000002',
        scheduled_for: now.toISOString(),
      }),
    );
    // New due critical candidate — should bypass.
    await deps.candidateRepo.insert(
      makeCandidate({
        id: '00000000-0000-0000-0000-000000000003',
        scheduled_for: now.toISOString(),
        critical: true,
      }),
    );

    const result = await runSchedulerOnce(deps, 't1');

    const dispatchedIds = result.dispatched.map((d) => d.candidate_id);
    expect(dispatchedIds).toContain(
      '00000000-0000-0000-0000-000000000003',
    );
    const suppressedIds = result.suppressed.map((s) => s.candidate_id);
    expect(suppressedIds).toContain(
      '00000000-0000-0000-0000-000000000002',
    );
    const capSup = result.suppressed.find(
      (s) => s.candidate_id === '00000000-0000-0000-0000-000000000002',
    );
    expect(capSup?.reason).toBe('daily_cap');
  });

  it('suppresses when the user has opted out of every channel', async () => {
    const now = new Date('2026-05-26T12:00:00.000Z');
    const deps = await buildDeps(now);
    await deps.prefsRepo.upsert(makePrefs({ allowed_channels: [] }));
    await deps.candidateRepo.insert(
      makeCandidate({ scheduled_for: now.toISOString() }),
    );

    const result = await runSchedulerOnce(deps, 't1');

    expect(result.dispatched).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    const r = result.suppressed[0];
    expect(r).toBeDefined();
    if (r === undefined) throw new Error('r undefined');
    expect(r.reason).toBe('channel_disallowed');
  });

  it('uses default preferences when none are stored for the user', async () => {
    const now = new Date('2026-05-26T12:00:00.000Z');
    const deps = await buildDeps(now);
    // NO upsert into prefs — exercise the default fallback.
    await deps.candidateRepo.insert(
      makeCandidate({ scheduled_for: now.toISOString() }),
    );
    const result = await runSchedulerOnce(deps, 't1');
    expect(result.dispatched).toHaveLength(1);
  });
});
