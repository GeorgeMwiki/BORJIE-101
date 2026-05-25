import { describe, expect, it } from 'vitest';
import {
  autoTriggerCoaching,
  generateCoachingPrompt,
  mentionsDisciplinaryLanguage,
} from '../coaching-generator.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { PerformanceSignal } from '../types.js';

describe('mentionsDisciplinaryLanguage', () => {
  it('flags terminate / fire / dismiss / PIP / final warning / write-up', () => {
    expect(mentionsDisciplinaryLanguage('we may terminate your contract')).toBe(true);
    expect(mentionsDisciplinaryLanguage('this is a final warning')).toBe(true);
    expect(mentionsDisciplinaryLanguage('placing you on a PIP')).toBe(true);
    expect(mentionsDisciplinaryLanguage('write-up forthcoming')).toBe(true);
    expect(mentionsDisciplinaryLanguage('you are dismissed')).toBe(true);
  });

  it('does not flag normal coaching text', () => {
    expect(mentionsDisciplinaryLanguage('let us set up a 1-on-1 to discuss progress')).toBe(false);
  });
});

describe('generateCoachingPrompt', () => {
  it('writes status=sent for non-disciplinary text', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    fx.content.coachingText = 'Great work! Let us catch up Friday.';
    const r = await generateCoachingPrompt(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
      triggerKind: 'exceptional_recognition',
    });
    expect(r.status).toBe('sent');
    expect(r.sentAt).not.toBeNull();
    expect(fx.channel.sent).toHaveLength(1);
  });

  it('writes status=pending for disciplinary text and does not send', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    fx.content.coachingText = 'If this continues we may terminate your contract.';
    const r = await generateCoachingPrompt(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
      triggerKind: 'repeated_blocker',
    });
    expect(r.status).toBe('pending');
    expect(r.sentAt).toBeNull();
    expect(fx.channel.sent).toHaveLength(0);
  });

  it('refuses when employee is missing', async () => {
    const fx = makeFixture();
    await expect(
      generateCoachingPrompt(fx.deps, {
        tenantId: 't1',
        employeeId: 'ghost',
        triggerKind: 'repeated_blocker',
      })
    ).rejects.toThrow();
  });
});

describe('autoTriggerCoaching', () => {
  it('fires repeated_blocker on >=1 signal', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    const sig: PerformanceSignal = {
      id: 's1',
      tenantId: 't1',
      employeeId: 'emp-1',
      signalKind: 'repeated_blocker',
      weight: -2,
      contextJsonb: {},
      sourceKind: 'check_in',
      sourceRef: null,
      createdAt: '2026-05-22T00:00:00Z',
    };
    fx.store.signals = [sig];
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toContain('repeated_blocker');
    expect(fx.store.coaching).toHaveLength(1);
  });

  it('fires missed_deadline on >=2 signals', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    for (let i = 0; i < 2; i += 1) {
      fx.store.signals = [
        ...fx.store.signals,
        {
          id: `s${i}`,
          tenantId: 't1',
          employeeId: 'emp-1',
          signalKind: 'missed_deadline',
          weight: -1.5,
          contextJsonb: {},
          sourceKind: 'audit_event',
          sourceRef: null,
          createdAt: '2026-05-22T00:00:00Z',
        },
      ];
    }
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toContain('missed_deadline');
  });

  it('fires low_sentiment after 3 negative_sentiment signals', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    for (let i = 0; i < 3; i += 1) {
      fx.store.signals = [
        ...fx.store.signals,
        {
          id: `s${i}`,
          tenantId: 't1',
          employeeId: 'emp-1',
          signalKind: 'negative_sentiment',
          weight: -0.5,
          contextJsonb: {},
          sourceKind: 'check_in',
          sourceRef: null,
          createdAt: '2026-05-22T00:00:00Z',
        },
      ];
    }
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toContain('low_sentiment');
  });

  it('fires exceptional_recognition on positive milestone', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    fx.store.signals = [
      {
        id: 's1',
        tenantId: 't1',
        employeeId: 'emp-1',
        signalKind: 'exceptional_work',
        weight: 2,
        contextJsonb: {},
        sourceKind: 'manual',
        sourceRef: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ];
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toContain('exceptional_recognition');
  });

  it('fires no triggers when nothing crossed threshold', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toEqual([]);
    expect(fx.store.coaching).toHaveLength(0);
  });
});
