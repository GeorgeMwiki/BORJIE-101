import { describe, expect, it } from 'vitest';
import { detectLanguage, detectLanguageSync } from '../detect.js';

describe('detectLanguage (async, fallback heuristic)', () => {
  it('detects Swahili from a mining document phrase', async () => {
    const code = await detectLanguage(
      'Mkataba wa madini, mnunuzi atalipa mrabaha ya kila mwezi.',
      { loader: async () => null }
    );
    expect(code).toBe('sw');
  });

  it('detects French from a contract phrase', async () => {
    const code = await detectLanguage(
      "L'acheteur doit payer la redevance mensuelle à la date convenue.",
      { loader: async () => null }
    );
    expect(code).toBe('fr');
  });

  it('detects English when keywords match', async () => {
    const code = await detectLanguage(
      'The buyer shall pay the royalty each month on the agreed date.',
      { loader: async () => null }
    );
    expect(code).toBe('en');
  });

  it('detects Arabic by script range', async () => {
    const code = await detectLanguage('عقد تعدين شهري', { loader: async () => null });
    expect(code).toBe('ar');
  });

  it('returns "und" for empty input', async () => {
    expect(await detectLanguage('', { loader: async () => null })).toBe('und');
  });

  it('returns "und" for unrecognized input', async () => {
    const code = await detectLanguage('xyz qqq pwn', { loader: async () => null });
    expect(code).toBe('und');
  });

  it('uses franc loader when present', async () => {
    const fakeFranc = (_: string) => 'eng';
    const code = await detectLanguage('arbitrary text', {
      loader: async () => fakeFranc,
    });
    expect(code).toBe('en');
  });
});

describe('detectLanguageSync', () => {
  it('detects Swahili synchronously', () => {
    const code = detectLanguageSync('Mwenye madini na mnunuzi wamekubaliana.');
    expect(code).toBe('sw');
  });
  it('detects Amharic by script', () => {
    expect(detectLanguageSync('ሰላም ለሁሉም')).toBe('am');
  });
  it('returns "und" for whitespace', () => {
    expect(detectLanguageSync('   ')).toBe('und');
  });
});
