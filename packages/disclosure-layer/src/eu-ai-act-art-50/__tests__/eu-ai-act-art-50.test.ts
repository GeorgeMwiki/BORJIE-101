import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  ENFORCEMENT_DATE_UNIX_MS,
  type DisclosureSurface,
  REQUIRED_SURFACES,
  buildDisclosureText,
  getMandatoryDisclosure,
} from '../index.js';

describe('eu-ai-act-art-50: legal contract', () => {
  it('lists all 5 required surfaces', () => {
    expect(REQUIRED_SURFACES).toHaveLength(5);
    expect(REQUIRED_SURFACES).toContain('chat');
    expect(REQUIRED_SURFACES).toContain('whatsapp');
    expect(REQUIRED_SURFACES).toContain('sms');
    expect(REQUIRED_SURFACES).toContain('email');
    expect(REQUIRED_SURFACES).toContain('voice');
  });

  it('cites Art. 50 in every disclosure result', () => {
    const r = getMandatoryDisclosure({ surface: 'chat', isFirstInteraction: true });
    expect(r.statute).toBe('EU AI Act Art. 50');
  });

  it('ENFORCEMENT_DATE_UNIX_MS is Aug 2 2026 UTC', () => {
    const d = new Date(ENFORCEMENT_DATE_UNIX_MS);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(7); // August
    expect(d.getUTCDate()).toBe(2);
  });

  it('DEFAULT_LOCALE is en-TZ', () => {
    expect(DEFAULT_LOCALE).toBe('en-TZ');
  });
});

describe('eu-ai-act-art-50: first-turn declaration fires per surface', () => {
  it.each<DisclosureSurface>(['chat', 'whatsapp', 'sms', 'email', 'voice'])(
    'emits non-empty text on first interaction for %s',
    (surface) => {
      const r = getMandatoryDisclosure({ surface, isFirstInteraction: true });
      expect(r.emit).toBe(true);
      expect(r.text.length).toBeGreaterThan(0);
    }
  );

  it.each<DisclosureSurface>(['chat', 'whatsapp', 'sms', 'email', 'voice'])(
    'does NOT emit text on a continuing interaction for %s',
    (surface) => {
      const r = getMandatoryDisclosure({ surface, isFirstInteraction: false });
      expect(r.emit).toBe(false);
      expect(r.text).toBe('');
    }
  );

  it('chat surface text mentions AI', () => {
    const r = getMandatoryDisclosure({ surface: 'chat', isFirstInteraction: true });
    expect(r.text.toLowerCase()).toContain('ai');
  });

  it('email surface text mentions the statute explicitly', () => {
    const r = getMandatoryDisclosure({ surface: 'email', isFirstInteraction: true });
    expect(r.text).toContain('Art. 50');
  });

  it('sms surface text offers HUMAN handoff keyword', () => {
    const r = getMandatoryDisclosure({ surface: 'sms', isFirstInteraction: true });
    expect(r.text.toLowerCase()).toContain('human');
  });
});

describe('eu-ai-act-art-50: localisation (TZ Swahili + Rwanda French)', () => {
  it('emits Swahili identity for sw-TZ', () => {
    const r = getMandatoryDisclosure({
      surface: 'chat',
      locale: 'sw-TZ',
      isFirstInteraction: true,
    });
    expect(r.text.toLowerCase()).toContain('msaidizi wa ai');
  });

  it('emits Swahili identity for sw-KE', () => {
    const r = getMandatoryDisclosure({
      surface: 'whatsapp',
      locale: 'sw-KE',
      isFirstInteraction: true,
    });
    expect(r.text.toLowerCase()).toContain('msaidizi wa ai');
  });

  it('emits French for fr-RW (Rwanda)', () => {
    const r = getMandatoryDisclosure({
      surface: 'chat',
      locale: 'fr-RW',
      isFirstInteraction: true,
    });
    expect(r.text.toLowerCase()).toContain('assistant ia');
  });

  it('falls back to English when locale is unknown', () => {
    const r = getMandatoryDisclosure({
      surface: 'chat',
      // @ts-expect-error — testing fallback path
      locale: 'zz-XX',
      isFirstInteraction: true,
    });
    expect(r.text).toContain('AI');
  });

  it('en-TZ default — English, Tanzania jurisdiction', () => {
    const r = getMandatoryDisclosure({ surface: 'chat', isFirstInteraction: true });
    expect(r.locale).toBe('en-TZ');
    expect(r.text).toContain('AI assistant');
  });
});

describe('eu-ai-act-art-50: buildDisclosureText (direct)', () => {
  it('produces email footer with [AI Disclosure] tag', () => {
    const t = buildDisclosureText('email', 'en');
    expect(t).toContain('[AI Disclosure]');
  });

  it('produces sms text under 160 chars (one SMS segment)', () => {
    const t = buildDisclosureText('sms', 'en');
    expect(t.length).toBeLessThanOrEqual(160);
  });

  it('voice surface returns identity only (no chat handoff line)', () => {
    const t = buildDisclosureText('voice', 'en');
    expect(t).not.toContain("Type 'human'");
  });
});
