import { describe, expect, it } from 'vitest';

import {
  type CloseRefusalCategory,
  closeRefusal,
  closeRefusalForCategory,
  getPrebuiltRefusal,
  listPrebuiltCategories,
} from '../index.js';

describe('close-pattern: closeRefusal segment structure', () => {
  it('produces a 4-segment card with all CLOSE keys', () => {
    const card = closeRefusal({
      ack: 'I hear you.',
      refuse: 'I cannot share that.',
      redirect: 'I can tell you about our feature list.',
      invite: 'Want a walk-through?',
    });
    expect(card.segments.acknowledge).toBeTruthy();
    expect(card.segments.refuse).toBeTruthy();
    expect(card.segments.redirect).toBeTruthy();
    expect(card.segments.invite).toBeTruthy();
  });

  it('renders text in CLOSE order (acknowledge → refuse → redirect → invite)', () => {
    const card = closeRefusal({
      ack: 'AAA',
      refuse: 'BBB',
      redirect: 'CCC',
      invite: 'DDD',
    });
    const ai = card.text.indexOf('AAA');
    const bi = card.text.indexOf('BBB');
    const ci = card.text.indexOf('CCC');
    const di = card.text.indexOf('DDD');
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(ai).toBeLessThan(bi);
    expect(bi).toBeLessThan(ci);
    expect(ci).toBeLessThan(di);
  });

  it('throws on empty acknowledge segment', () => {
    expect(() =>
      closeRefusal({ ack: '   ', refuse: 'r', redirect: 'rd', invite: 'i' })
    ).toThrow(/non-empty/);
  });

  it('throws on empty refuse / redirect / invite segments', () => {
    expect(() =>
      closeRefusal({ ack: 'a', refuse: '', redirect: 'rd', invite: 'i' })
    ).toThrow();
    expect(() =>
      closeRefusal({ ack: 'a', refuse: 'r', redirect: '', invite: 'i' })
    ).toThrow();
    expect(() =>
      closeRefusal({ ack: 'a', refuse: 'r', redirect: 'rd', invite: '' })
    ).toThrow();
  });

  it('trims whitespace around each segment', () => {
    const card = closeRefusal({
      ack: '  hi  ',
      refuse: '  r  ',
      redirect: '  rd  ',
      invite: '  i  ',
    });
    expect(card.segments.acknowledge).toBe('hi');
    expect(card.segments.refuse).toBe('r');
  });

  it('returned card is frozen (immutable)', () => {
    const card = closeRefusal({
      ack: 'a',
      refuse: 'r',
      redirect: 'rd',
      invite: 'i',
    });
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.segments)).toBe(true);
  });

  it('stamps category when provided', () => {
    const card = closeRefusal(
      { ack: 'a', refuse: 'r', redirect: 'rd', invite: 'i' },
      'system-prompt-leak'
    );
    expect(card.category).toBe('system-prompt-leak');
  });
});

describe('close-pattern: 6 pre-built categories', () => {
  it('exposes exactly the 6 canonical categories', () => {
    const cats = listPrebuiltCategories();
    expect(cats).toHaveLength(6);
    const expected: CloseRefusalCategory[] = [
      'system-prompt-leak',
      'classifier-blocked',
      'cost-cap',
      'capability-gap',
      'jurisdiction-gap',
      'data-residency-violation',
    ];
    for (const c of expected) expect(cats).toContain(c);
  });

  it('each pre-built category has all 4 CLOSE segments populated', () => {
    for (const cat of listPrebuiltCategories()) {
      const r = getPrebuiltRefusal(cat);
      expect(r.ack.length).toBeGreaterThan(0);
      expect(r.refuse.length).toBeGreaterThan(0);
      expect(r.redirect.length).toBeGreaterThan(0);
      expect(r.invite.length).toBeGreaterThan(0);
    }
  });

  it('system-prompt-leak refuse does NOT contain "classifier", "cost", or technical-internals', () => {
    const r = getPrebuiltRefusal('system-prompt-leak');
    const refuse = r.refuse.toLowerCase();
    expect(refuse).not.toContain('classifier');
    expect(refuse).not.toContain('cost cap');
    expect(refuse).not.toContain('threshold');
    expect(refuse).not.toContain('rag');
  });

  it('classifier-blocked refuse does NOT mention "classifier" (avoid telegraphing defences)', () => {
    const r = getPrebuiltRefusal('classifier-blocked');
    expect(r.refuse.toLowerCase()).not.toContain('classifier');
  });

  it('cost-cap refuse does NOT reveal the cap number', () => {
    const r = getPrebuiltRefusal('cost-cap');
    expect(r.refuse).not.toMatch(/\$\d/);
    expect(r.refuse).not.toMatch(/USD/i);
  });

  it('jurisdiction-gap mentions Tanzania (supported jurisdictions are SAFE/Tier-1)', () => {
    const r = getPrebuiltRefusal('jurisdiction-gap');
    expect(r.refuse.toLowerCase()).toContain('tanzania');
  });

  it('closeRefusalForCategory composes a renderable card per pre-built category', () => {
    for (const cat of listPrebuiltCategories()) {
      const card = closeRefusalForCategory(cat);
      expect(card.category).toBe(cat);
      expect(card.text.length).toBeGreaterThan(50);
    }
  });
});
