import { describe, expect, it } from 'vitest';
import { createInMemoryUtteranceRepository } from '../repositories/utterance-repository.js';
import type { Prosody, RecordUtteranceInput } from '../types.js';

const PROSODY_FIXTURE: Prosody = {
  f0Contour: new Array<number>(16).fill(120),
  stressBins: new Array<number>(8).fill(0.2),
  intonationShape: 'flat',
};

function baseInput(
  overrides: Partial<RecordUtteranceInput> = {},
): RecordUtteranceInput {
  return {
    tenantId: 'A',
    userId: 'u1',
    channel: 'voice',
    sourceLang: 'sw',
    detectedLang: 'sw',
    text: 'Habari yako leo',
    phonemes: [],
    prosody: PROSODY_FIXTURE,
    codeswitchSegments: [],
    confidence: 0.9,
    provider: 'lelapa-vulavula',
    consentState: 'subject-opt-in',
    ...overrides,
  };
}

describe('utterance repository (consent + audit chain)', () => {
  it('records an utterance and returns the frozen row', async () => {
    const repo = createInMemoryUtteranceRepository();
    const row = await repo.recordUtterance(baseInput());
    expect(row).not.toBeNull();
    expect(row!.auditHash).toBeTruthy();
    expect(Object.isFrozen(row)).toBe(true);
  });

  it('drops writes with an unknown consent state silently', async () => {
    const repo = createInMemoryUtteranceRepository();
    const row = await repo.recordUtterance(
      baseInput({ consentState: 'invalid' as never }),
    );
    expect(row).toBeNull();
    const recent = await repo.listRecentForTenant('A', 10);
    expect(recent).toHaveLength(0);
  });

  it('chains the audit hash across writes for one tenant', async () => {
    const repo = createInMemoryUtteranceRepository();
    const r1 = await repo.recordUtterance(baseInput());
    const r2 = await repo.recordUtterance(
      baseInput({ text: 'Asante sana' }),
    );
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // Second row's prevHash must equal first row's auditHash
    expect(r2!.prevHash).toBe(r1!.auditHash);
  });

  it('isolates the chain per tenant', async () => {
    const repo = createInMemoryUtteranceRepository();
    const rA1 = await repo.recordUtterance(baseInput({ tenantId: 'A' }));
    const rB1 = await repo.recordUtterance(baseInput({ tenantId: 'B' }));
    expect(rA1!.prevHash).toBe(rB1!.prevHash); // both start at GENESIS
    const rA2 = await repo.recordUtterance(baseInput({ tenantId: 'A' }));
    expect(rA2!.prevHash).toBe(rA1!.auditHash);
    // Tenant B's chain remains at the first row's prev (genesis)
    const rB2 = await repo.recordUtterance(baseInput({ tenantId: 'B' }));
    expect(rB2!.prevHash).toBe(rB1!.auditHash);
  });

  it('findById respects the tenant boundary', async () => {
    const repo = createInMemoryUtteranceRepository();
    const r = await repo.recordUtterance(baseInput());
    expect(await repo.findById('A', r!.id)).toEqual(r);
    expect(await repo.findById('B', r!.id)).toBeNull();
  });

  it('listRecentForUser filters by tenant and user', async () => {
    const repo = createInMemoryUtteranceRepository();
    await repo.recordUtterance(baseInput({ userId: 'u1' }));
    await repo.recordUtterance(baseInput({ userId: 'u2' }));
    await repo.recordUtterance(baseInput({ userId: 'u1' }));
    const u1 = await repo.listRecentForUser('A', 'u1', 10);
    expect(u1.every((r) => r.userId === 'u1')).toBe(true);
    expect(u1).toHaveLength(2);
  });

  it('supports voice / chat / sms / whatsapp channels', async () => {
    const repo = createInMemoryUtteranceRepository();
    await repo.recordUtterance(baseInput({ channel: 'voice' }));
    await repo.recordUtterance(baseInput({ channel: 'chat' }));
    await repo.recordUtterance(baseInput({ channel: 'sms' }));
    await repo.recordUtterance(baseInput({ channel: 'whatsapp' }));
    const all = await repo.listRecentForTenant('A', 10);
    const channels = all.map((r) => r.channel).sort();
    expect(channels).toEqual(['chat', 'sms', 'voice', 'whatsapp']);
  });
});
