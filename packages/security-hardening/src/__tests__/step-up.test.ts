import { describe, it, expect } from 'vitest';

import {
  createStepUpService,
  createInMemoryStepUpStore,
} from '../mfa/step-up.js';
import { createInMemoryAdapter } from '../mfa/channels.js';

describe('step-up MFA orchestrator', () => {
  it('opens a challenge when no prior MFA exists for the user', async () => {
    let t = 1_000;
    const svc = createStepUpService({
      store: createInMemoryStepUpStore(),
      freshnessMs: 60_000,
      now: () => t,
      newId: () => 'chal-1',
    });
    const res = await svc.require({
      userId: 'u1',
      tenantId: 'tA',
      channel: 'totp',
    });
    expect(res.status).toBe('challenge_required');
    if (res.status === 'challenge_required') {
      expect(res.challenge.id).toBe('chal-1');
      expect(res.challenge.userId).toBe('u1');
      expect(res.challenge.tenantId).toBe('tA');
      expect(res.challenge.expiresAt).toBeGreaterThan(t);
    }
  });

  it('returns `fresh` when a prior MFA happened within the freshness window', async () => {
    let t = 1_000;
    const store = createInMemoryStepUpStore();
    const svc = createStepUpService({
      store,
      freshnessMs: 60_000,
      now: () => t,
      newId: () => 'chal-1',
    });
    const open = await svc.require({
      userId: 'u1',
      tenantId: 'tA',
      channel: 'totp',
    });
    if (open.status !== 'challenge_required') throw new Error('unexpected');
    await svc.submit({
      challengeId: open.challenge.id,
      verify: async () => true,
    });
    t += 30_000;
    const second = await svc.require({
      userId: 'u1',
      tenantId: 'tA',
      channel: 'totp',
    });
    expect(second.status).toBe('fresh');
  });

  it('re-opens a challenge when the freshness window has elapsed', async () => {
    let t = 1_000;
    let id = 0;
    const store = createInMemoryStepUpStore();
    const svc = createStepUpService({
      store,
      freshnessMs: 10_000,
      now: () => t,
      newId: () => `chal-${++id}`,
    });
    const first = await svc.require({
      userId: 'u1',
      tenantId: 'tA',
      channel: 'totp',
    });
    if (first.status !== 'challenge_required') throw new Error('unexpected');
    await svc.submit({
      challengeId: first.challenge.id,
      verify: async () => true,
    });
    t += 60_000;
    const second = await svc.require({
      userId: 'u1',
      tenantId: 'tA',
      channel: 'totp',
    });
    expect(second.status).toBe('challenge_required');
  });

  it('REJECTS submission past the challenge TTL', async () => {
    let t = 1_000;
    const svc = createStepUpService({
      store: createInMemoryStepUpStore(),
      freshnessMs: 60_000,
      challengeTTLms: 5_000,
      now: () => t,
      newId: () => 'chal-x',
    });
    const open = await svc.require({
      userId: 'u',
      tenantId: 'tA',
      channel: 'totp',
    });
    if (open.status !== 'challenge_required') throw new Error('unexpected');
    t += 60_000;
    const submit = await svc.submit({
      challengeId: open.challenge.id,
      verify: async () => true,
    });
    expect(submit.status).toBe('rejected');
    if (submit.status === 'rejected') {
      expect(submit.reason).toBe('expired');
    }
  });

  it('REJECTS re-submission of an already-satisfied challenge', async () => {
    let t = 1_000;
    const svc = createStepUpService({
      store: createInMemoryStepUpStore(),
      freshnessMs: 60_000,
      now: () => t,
      newId: () => 'chal-y',
    });
    const open = await svc.require({
      userId: 'u',
      tenantId: 'tA',
      channel: 'totp',
    });
    if (open.status !== 'challenge_required') throw new Error('unexpected');
    await svc.submit({
      challengeId: open.challenge.id,
      verify: async () => true,
    });
    const second = await svc.submit({
      challengeId: open.challenge.id,
      verify: async () => true,
    });
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.reason).toBe('already_satisfied');
    }
  });

  it('REJECTS unknown challenge ids', async () => {
    const svc = createStepUpService({
      store: createInMemoryStepUpStore(),
      freshnessMs: 60_000,
    });
    const submit = await svc.submit({
      challengeId: 'does-not-exist',
      verify: async () => true,
    });
    expect(submit.status).toBe('rejected');
    if (submit.status === 'rejected') {
      expect(submit.reason).toBe('unknown_challenge');
    }
  });
});

describe('in-memory MFA channel adapter', () => {
  it('records every delivery in order', async () => {
    let t = 1;
    const adapter = createInMemoryAdapter(() => t++);
    await adapter.deliver({
      channel: 'sms',
      userId: 'u',
      tenantId: 't',
      to: '+254700000001',
      code: '123456',
    });
    await adapter.deliver({
      channel: 'totp',
      userId: 'u',
      tenantId: 't',
      to: 'app',
      code: '654321',
    });
    expect(adapter.deliveries.length).toBe(2);
    expect(adapter.deliveries[0]?.channel).toBe('sms');
    expect(adapter.deliveries[1]?.code).toBe('654321');
    adapter.clear();
    expect(adapter.deliveries.length).toBe(0);
  });
});
