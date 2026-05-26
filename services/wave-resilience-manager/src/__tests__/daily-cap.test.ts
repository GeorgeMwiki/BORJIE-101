import { describe, it, expect } from 'vitest';
import { decideRevival } from '../decider/revival-decider.js';
import { createInMemoryProgressRepository } from '../storage/progress-repository.js';
import {
  createInMemoryDailyCounterRepository,
  todayUtc,
} from '../storage/daily-counter-repository.js';
import { resumeWave, type AgentDispatcher } from '../resumer/agent-resumer.js';
import { createInMemoryAttemptsRepository } from '../storage/attempts-repository.js';
import type {
  Notifier,
  UnrecoverableNotice,
} from '../notification/notifier-interface.js';

function recordingDispatcher(): AgentDispatcher & {
  readonly calls: ReadonlyArray<{ readonly waveId: string }>;
} {
  const calls: Array<{ waveId: string }> = [];
  return {
    calls,
    async dispatch({ waveId }) {
      calls.push({ waveId });
      return { agent_id: `agent-${calls.length}` };
    },
  };
}

function recordingNotifier(): Notifier & {
  readonly calls: ReadonlyArray<UnrecoverableNotice>;
} {
  const calls: UnrecoverableNotice[] = [];
  return {
    calls,
    async notifyUnrecoverable(notice) {
      calls.push(notice);
      return true;
    },
  };
}

describe('todayUtc', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(todayUtc(new Date(Date.UTC(2026, 4, 26, 12, 0, 0)))).toBe(
      '2026-05-26',
    );
  });
  it('zero-pads month + day', () => {
    expect(todayUtc(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });
});

describe('daily revival budget (founder #5: 50/day)', () => {
  it('decider does NOT enforce the cap when deps are absent', async () => {
    const progress = createInMemoryProgressRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });
    const d = await decideRevival(
      { progress },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(true);
    expect(d.reason).toBe('checkpoint_resumable');
  });

  it('decider blocks revival when today count >= budget', async () => {
    const progress = createInMemoryProgressRepository();
    const counters = createInMemoryDailyCounterRepository();
    // Pre-populate to the cap (50 attempts already used today).
    for (let i = 0; i < 50; i += 1) {
      await counters.incrementToday();
    }
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });
    const d = await decideRevival(
      { progress, dailyBudget: 50, dailyCounters: counters },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(false);
    expect(d.reason).toBe('daily_budget_exhausted');
  });

  it('decider allows revival when today count < budget', async () => {
    const progress = createInMemoryProgressRepository();
    const counters = createInMemoryDailyCounterRepository();
    await counters.incrementToday();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });
    const d = await decideRevival(
      { progress, dailyBudget: 50, dailyCounters: counters },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(true);
  });

  it('resumer marks the wave unrecoverable + notifies on cap', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const counters = createInMemoryDailyCounterRepository();
    const dispatcher = recordingDispatcher();
    const notifier = recordingNotifier();

    for (let i = 0; i < 50; i += 1) await counters.incrementToday();

    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });

    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
        dailyBudget: 50,
        dailyCounters: counters,
        notifier,
      },
      { waveId: 'W', originalPrompt: 'p' },
    );

    expect(r.resumed).toBe(false);
    expect(r.decision.reason).toBe('daily_budget_exhausted');
    expect(dispatcher.calls.length).toBe(0);
    expect(notifier.calls.length).toBe(1);
    expect(notifier.calls[0]?.reason).toBe('daily_budget_exhausted');
    expect(notifier.calls[0]?.wave_id).toBe('W');

    const history = await progress.listForWave('W');
    expect(history[history.length - 1]?.status).toBe('unrecoverable');
  });

  it('resumer increments the daily counter on successful dispatch', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const counters = createInMemoryDailyCounterRepository();
    const dispatcher = recordingDispatcher();

    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });

    expect(await counters.getTodayAttemptCount()).toBe(0);

    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
        dailyBudget: 50,
        dailyCounters: counters,
      },
      { waveId: 'W', originalPrompt: 'p' },
    );

    expect(r.resumed).toBe(true);
    expect(await counters.getTodayAttemptCount()).toBe(1);
  });

  it('also notifies on the per-wave 3-attempt cap (founder #1)', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const dispatcher = recordingDispatcher();
    const notifier = recordingNotifier();

    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 3,
      audit_hash: 'h',
    });

    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
        maxAttempts: 3,
        notifier,
      },
      { waveId: 'W', originalPrompt: 'p' },
    );

    expect(r.resumed).toBe(false);
    expect(notifier.calls.length).toBe(1);
    expect(notifier.calls[0]?.reason).toBe('max_attempts_reached');
  });
});
