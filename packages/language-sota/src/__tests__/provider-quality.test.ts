import { describe, expect, it } from 'vitest';
import { createInMemoryProviderQualityRepository } from '../repositories/provider-quality-repository.js';
import { createQualityTracker } from '../providers/quality-tracker.js';
import { createProviderRegistry } from '../providers/provider-registry.js';
import type { ClockPort } from '../types.js';

function fixedClock(start: Date): { readonly clock: ClockPort; advanceMs: (ms: number) => void } {
  let t = start.getTime();
  return {
    clock: { now: () => new Date(t) },
    advanceMs(ms) {
      t += ms;
    },
  };
}

describe('provider-quality repository + tracker', () => {
  it('persists a row and reads it back as latest', async () => {
    const repo = createInMemoryProviderQualityRepository();
    const tracker = createQualityTracker({ repository: repo });
    const row = await tracker.record({
      tenantId: 'tenant-A',
      provider: 'gemini-live',
      lang: 'en',
      wer: 0.08,
      per: 0.05,
      mos: 4.2,
      sampleN: 100,
    });
    expect(row.tenantId).toBe('tenant-A');
    expect(row.auditHash).toBeTruthy();
    const latest = await tracker.latest('tenant-A', 'gemini-live', 'en');
    expect(latest?.id).toBe(row.id);
  });

  it('returns null for missing tuples', async () => {
    const repo = createInMemoryProviderQualityRepository();
    const tracker = createQualityTracker({ repository: repo });
    const latest = await tracker.latest('tenant-A', 'gemini-live', 'sw');
    expect(latest).toBeNull();
  });

  it('hash-chains successive samples per (tenant, provider, lang)', async () => {
    const t = fixedClock(new Date('2026-05-26T00:00:00Z'));
    const repo = createInMemoryProviderQualityRepository({ clock: t.clock });
    const r1 = await repo.record({
      tenantId: 'A',
      provider: 'eleven-v3',
      lang: 'sw',
      wer: 0.1,
      per: 0.07,
      mos: 4.0,
      sampleN: 50,
    });
    t.advanceMs(60_000);
    const r2 = await repo.record({
      tenantId: 'A',
      provider: 'eleven-v3',
      lang: 'sw',
      wer: 0.09,
      per: 0.06,
      mos: 4.1,
      sampleN: 60,
    });
    expect(r2.auditHash).not.toBe(r1.auditHash);
    // chain head should now be r2's hash; next record must use it
    const r3 = await repo.record({
      tenantId: 'A',
      provider: 'eleven-v3',
      lang: 'sw',
      wer: 0.08,
      per: 0.05,
      mos: 4.2,
      sampleN: 80,
    });
    expect(r3.auditHash).not.toBe(r2.auditHash);
  });

  it('rankForLanguage returns providers sorted by WER asc', async () => {
    const repo = createInMemoryProviderQualityRepository();
    const tracker = createQualityTracker({ repository: repo });
    await tracker.record({
      tenantId: 'A',
      provider: 'whisper-large-v3',
      lang: 'sw',
      wer: 0.14,
      per: 0.1,
      mos: 3.7,
      sampleN: 50,
    });
    await tracker.record({
      tenantId: 'A',
      provider: 'lelapa-vulavula',
      lang: 'sw',
      wer: 0.09,
      per: 0.06,
      mos: 4.1,
      sampleN: 60,
    });
    await tracker.record({
      tenantId: 'A',
      provider: 'gcp-stt-chirp',
      lang: 'sw',
      wer: 0.11,
      per: 0.08,
      mos: 3.9,
      sampleN: 80,
    });
    const ranked = await tracker.rankForLanguage('A', 'sw');
    expect(ranked.map((r) => r.provider)).toEqual([
      'lelapa-vulavula',
      'gcp-stt-chirp',
      'whisper-large-v3',
    ]);
  });

  it('provider registry indexes by (capability, language)', () => {
    const reg = createProviderRegistry();
    reg.register({
      id: 'lelapa-vulavula',
      capabilities: ['stt', 'translate'],
      supportedLanguages: ['sw', 'sheng'],
    });
    reg.register({
      id: 'eleven-v3',
      capabilities: ['tts'],
      supportedLanguages: ['en', 'sw'],
    });
    const swStt = reg.findBy('stt', 'sw');
    expect(swStt.map((p) => p.id)).toEqual(['lelapa-vulavula']);
    const enTts = reg.findBy('tts', 'en');
    expect(enTts.map((p) => p.id)).toEqual(['eleven-v3']);
    const allSw = reg
      .list()
      .filter((p) => p.supportedLanguages.includes('sw'))
      .map((p) => p.id);
    expect(allSw.sort()).toEqual(['eleven-v3', 'lelapa-vulavula']);
  });

  it('rejects duplicate provider ids', () => {
    const reg = createProviderRegistry();
    reg.register({
      id: 'gemini-live',
      capabilities: ['stt', 'tts'],
      supportedLanguages: ['en'],
    });
    expect(() =>
      reg.register({
        id: 'gemini-live',
        capabilities: ['stt'],
        supportedLanguages: ['en'],
      }),
    ).toThrow();
  });
});
