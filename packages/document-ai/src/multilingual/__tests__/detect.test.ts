import { describe, expect, it } from 'vitest';
import { detectLanguage, detectLanguageSync } from '../detect.js';

describe('detectLanguage (async, fallback heuristic)', () => {
  it('detects Swahili from a property-management phrase', async () => {
    const code = await detectLanguage(
      'Mkataba wa pango wa nyumba, mpangaji atalipa kodi ya kila mwezi.',
      { loader: async () => null }
    );
    expect(code).toBe('sw');
  });

  it('detects French from a contract phrase', async () => {
    const code = await detectLanguage(
      'Le locataire doit payer le loyer mensuel à la date convenue.',
      { loader: async () => null }
    );
    expect(code).toBe('fr');
  });

  it('detects English when keywords match', async () => {
    const code = await detectLanguage(
      'The tenant shall pay the rent each month on the agreed date.',
      { loader: async () => null }
    );
    expect(code).toBe('en');
  });

  it('detects Arabic by script range', async () => {
    const code = await detectLanguage('عقد إيجار شهري', { loader: async () => null });
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
    const code = detectLanguageSync('Mwenye nyumba na mpangaji wamekubaliana.');
    expect(code).toBe('sw');
  });
  it('detects Amharic by script', () => {
    expect(detectLanguageSync('ሰላም ለሁሉም')).toBe('am');
  });
  it('returns "und" for whitespace', () => {
    expect(detectLanguageSync('   ')).toBe('und');
  });
});
