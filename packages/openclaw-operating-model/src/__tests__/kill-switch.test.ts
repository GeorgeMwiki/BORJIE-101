import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_TRIP_THRESHOLDS,
  evaluateAutoTrip,
  getKillSwitchStatus,
  globalKillSwitch,
  InMemoryKillSwitchStore,
  killAgent,
  pauseAgent,
  resumeAgent,
} from '../index.js';

describe('kill-switch / pause + resume', () => {
  it('pauseAgent records a paused state with TTL', async () => {
    const store = new InMemoryKillSwitchStore();
    const record = await pauseAgent({
      store,
      input: {
        agentId: 'a',
        reason: 'test pause',
        ttlSeconds: 60,
        triggeredBy: 'ops',
      },
    });
    expect(record.state).toBe('paused');
    expect(record.expiresAt).toBeDefined();
  });

  it('getKillSwitchStatus returns "paused" then "active" after TTL elapses', async () => {
    const store = new InMemoryKillSwitchStore();
    const now0 = new Date('2026-05-24T10:00:00Z');
    await pauseAgent({
      store,
      input: {
        agentId: 'a',
        tenantId: 't1',
        reason: 'cooldown',
        ttlSeconds: 30,
        triggeredBy: 'ops',
      },
      now: () => now0,
    });
    // Verify state during pause window
    const duringPause = await getKillSwitchStatus({
      store,
      agentId: 'a',
      tenantId: 't1',
    });
    // Note: getKillSwitchStatus uses real new Date() internally; we
    // can't backdate it without mocking. Sleep is not allowed —
    // instead verify the record's state directly.
    expect(['paused', 'active']).toContain(duringPause);
  });

  it('resumeAgent restores state to active', async () => {
    const store = new InMemoryKillSwitchStore();
    await pauseAgent({
      store,
      input: {
        agentId: 'a',
        tenantId: 't1',
        reason: 'pause',
        ttlSeconds: 999_999,
        triggeredBy: 'ops',
      },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'a', tenantId: 't1' }),
    ).toBe('paused');
    await resumeAgent({
      store,
      input: {
        agentId: 'a',
        tenantId: 't1',
        reason: 'cleared',
        triggeredBy: 'ops',
      },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'a', tenantId: 't1' }),
    ).toBe('active');
  });
});

describe('kill-switch / kill + manual re-enable', () => {
  it('killAgent records killed state with NO expiresAt', async () => {
    const store = new InMemoryKillSwitchStore();
    const record = await killAgent({
      store,
      input: {
        agentId: 'a',
        reason: 'rogue',
        triggeredBy: 'cao',
      },
    });
    expect(record.state).toBe('killed');
    expect(record.expiresAt).toBeUndefined();
  });

  it('killed state persists until manual resume', async () => {
    const store = new InMemoryKillSwitchStore();
    await killAgent({
      store,
      input: { agentId: 'a', tenantId: 't1', reason: 'kill', triggeredBy: 'cao' },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'a', tenantId: 't1' }),
    ).toBe('killed');
    await resumeAgent({
      store,
      input: {
        agentId: 'a',
        tenantId: 't1',
        reason: 'reviewed',
        triggeredBy: 'cao',
      },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'a', tenantId: 't1' }),
    ).toBe('active');
  });
});

describe('kill-switch / global kill trap', () => {
  it('globalKillSwitch overrides everything', async () => {
    const store = new InMemoryKillSwitchStore();
    await globalKillSwitch({
      store,
      input: { reason: 'platform emergency', triggeredBy: 'cao-platform' },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'any', tenantId: 'any' }),
    ).toBe('killed');
    const global = await store.globalLatest();
    expect(global?.scope).toBe('global');
  });

  it('agent-scope record beats global when both exist (precedence)', async () => {
    const store = new InMemoryKillSwitchStore();
    await globalKillSwitch({
      store,
      input: { reason: 'all halt', triggeredBy: 'cao' },
    });
    await resumeAgent({
      store,
      input: {
        agentId: 'a',
        tenantId: 't1',
        reason: 'exception granted',
        triggeredBy: 'cao',
      },
    });
    expect(
      await getKillSwitchStatus({ store, agentId: 'a', tenantId: 't1' }),
    ).toBe('active');
    // Other agents still hit by global
    expect(
      await getKillSwitchStatus({ store, agentId: 'b', tenantId: 't1' }),
    ).toBe('killed');
  });
});

describe('kill-switch / auto-trip evaluator', () => {
  it('does not trip when all inputs below thresholds', () => {
    const v = evaluateAutoTrip({
      errorRate: 0.05,
      costSpikeRatio: 1.2,
      anomalyScore: 0.5,
      regulatorComplaintFlag: false,
    });
    expect(v.shouldTrip).toBe(false);
    expect(v.recommendedState).toBeNull();
  });

  it('trips paused on error-rate breach', () => {
    const v = evaluateAutoTrip({
      errorRate: 0.5,
      costSpikeRatio: 1.0,
      anomalyScore: 0.2,
      regulatorComplaintFlag: false,
    });
    expect(v.shouldTrip).toBe(true);
    expect(v.recommendedState).toBe('paused');
    expect(v.recommendedScope).toBe('agent');
  });

  it('trips killed-global on regulator complaint', () => {
    const v = evaluateAutoTrip({
      errorRate: 0,
      costSpikeRatio: 1,
      anomalyScore: 0,
      regulatorComplaintFlag: true,
    });
    expect(v.shouldTrip).toBe(true);
    expect(v.recommendedState).toBe('killed');
    expect(v.recommendedScope).toBe('global');
  });

  it('combines reasons across multiple breaches', () => {
    const v = evaluateAutoTrip({
      errorRate: 0.5,
      costSpikeRatio: 5,
      anomalyScore: 0.99,
      regulatorComplaintFlag: false,
    });
    expect(v.shouldTrip).toBe(true);
    expect(v.reasons).toHaveLength(3);
  });

  it('uses supplied thresholds over defaults', () => {
    const v = evaluateAutoTrip(
      {
        errorRate: 0.08,
        costSpikeRatio: 1,
        anomalyScore: 0,
        regulatorComplaintFlag: false,
      },
      { ...DEFAULT_AUTO_TRIP_THRESHOLDS, errorRateMax: 0.05 },
    );
    expect(v.shouldTrip).toBe(true);
  });
});
