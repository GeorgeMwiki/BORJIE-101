import { describe, it, expect } from 'vitest';
import { TalkTimeMeter } from '../index.js';

describe('TalkTimeMeter', () => {
  it('accumulates tenant + agent talk-seconds separately', () => {
    const meter = new TalkTimeMeter({ nowIso: '2026-05-25T08:00:00.000Z' });
    meter.observe({
      tenantId: 't1',
      agentId: 'a1',
      audioMs: 1500,
      isSpeech: true,
      speaker: 'tenant',
      observedAtIso: '2026-05-25T08:00:01.500Z',
    });
    meter.observe({
      tenantId: 't1',
      agentId: 'a1',
      audioMs: 2500,
      isSpeech: true,
      speaker: 'agent',
      observedAtIso: '2026-05-25T08:00:04.000Z',
    });
    meter.observe({
      tenantId: 't1',
      agentId: 'a1',
      audioMs: 800,
      isSpeech: false,
      speaker: 'tenant',
      observedAtIso: '2026-05-25T08:00:04.800Z',
    });
    const reading = meter.bill('t1', { nowIso: '2026-05-25T08:00:05.000Z' });
    expect(reading.tenantTalkSeconds).toBeCloseTo(1.5);
    expect(reading.agentTalkSeconds).toBeCloseTo(2.5);
    expect(reading.silenceSeconds).toBeCloseTo(0.8);
    expect(reading.totalSeconds).toBeCloseTo(4.8);
  });

  it('returns zero reading for a never-seen tenant', () => {
    const meter = new TalkTimeMeter();
    const reading = meter.bill('unknown-tenant');
    expect(reading.tenantTalkSeconds).toBe(0);
    expect(reading.totalSeconds).toBe(0);
  });

  it('reset() clears state and starts a new period', () => {
    const meter = new TalkTimeMeter({ nowIso: '2026-05-25T08:00:00.000Z' });
    meter.observe({
      tenantId: 't',
      agentId: 'a',
      audioMs: 1000,
      isSpeech: true,
      speaker: 'tenant',
      observedAtIso: '',
    });
    meter.reset({ nowIso: '2026-05-25T09:00:00.000Z' });
    const reading = meter.bill('t');
    expect(reading.totalSeconds).toBe(0);
    expect(reading.periodStartIso).toBe('2026-05-25T09:00:00.000Z');
  });

  it('throws on negative audioMs', () => {
    const meter = new TalkTimeMeter();
    expect(() =>
      meter.observe({
        tenantId: 't',
        agentId: 'a',
        audioMs: -1,
        isSpeech: true,
        speaker: 'tenant',
        observedAtIso: '',
      }),
    ).toThrow(/audioMs/);
  });

  it('listObservedTenants returns every tenant observed', () => {
    const meter = new TalkTimeMeter();
    meter.observe({
      tenantId: 't1',
      agentId: 'a1',
      audioMs: 100,
      isSpeech: true,
      speaker: 'tenant',
      observedAtIso: '',
    });
    meter.observe({
      tenantId: 't2',
      agentId: 'a1',
      audioMs: 200,
      isSpeech: true,
      speaker: 'tenant',
      observedAtIso: '',
    });
    expect([...meter.listObservedTenants()].sort()).toEqual(['t1', 't2']);
  });
});
