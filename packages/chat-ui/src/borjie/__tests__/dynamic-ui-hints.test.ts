/**
 * dynamic-ui-hints tests — DU-2/DU-3/DU-4 audit fix.
 *
 * Covers:
 *   - sw vs en variants ship every required id
 *   - thresholds match the canonical TOM trigger semantics
 *   - returned arrays are frozen + immutable
 *   - mastery-gate template contains {level}
 *   - learned-shortcuts headline returns string
 *   - action.emit strings are stable (regression-locked)
 */

import { describe, expect, it } from 'vitest';

import {
  borjieProactiveHints,
  borjieMasteryGateCopy,
  borjieLearnedShortcutsHeadline,
} from '../dynamic-ui-hints.js';

describe('borjieProactiveHints', () => {
  it('returns the four canonical hint ids in both languages', () => {
    const ids = ['borjie.frustration.handoff', 'borjie.comprehension.simpler', 'borjie.anxiety.safety', 'borjie.idle.cmdk'];
    expect(borjieProactiveHints('sw').map((h) => h.id)).toEqual(ids);
    expect(borjieProactiveHints('en').map((h) => h.id)).toEqual(ids);
  });

  it('preserves canonical thresholds across languages', () => {
    const sw = borjieProactiveHints('sw');
    const en = borjieProactiveHints('en');
    sw.forEach((h, i) => {
      expect(h.threshold).toBe(en[i]?.threshold);
      expect(h.trigger).toBe(en[i]?.trigger);
    });
    expect(sw[0]?.trigger).toBe('frustration');
    expect(sw[0]?.threshold).toBe(0.5);
    expect(sw[2]?.trigger).toBe('anxiety');
    expect(sw[2]?.threshold).toBe(0.6);
  });

  it('returns frozen arrays + frozen objects', () => {
    const hints = borjieProactiveHints('sw');
    expect(Object.isFrozen(hints)).toBe(true);
    expect(Object.isFrozen(hints[0])).toBe(true);
  });

  it('uses Swahili copy when language=sw', () => {
    const h = borjieProactiveHints('sw');
    expect(h[0]?.title).toContain('Inaonekana');
    expect(h[3]?.action?.label).toBe('Funza');
  });

  it('uses English copy when language=en', () => {
    const h = borjieProactiveHints('en');
    expect(h[0]?.title).toContain('Looks like');
    expect(h[3]?.action?.label).toBe('Show me');
  });

  it('keeps action.emit identifiers stable across languages (regression lock)', () => {
    const sw = borjieProactiveHints('sw');
    const en = borjieProactiveHints('en');
    sw.forEach((h, i) => {
      expect(h.action?.emit).toBe(en[i]?.action?.emit);
    });
  });
});

describe('borjieMasteryGateCopy', () => {
  it('includes {level} placeholder in template', () => {
    expect(borjieMasteryGateCopy('sw').hintTemplate).toContain('{level}');
    expect(borjieMasteryGateCopy('en').hintTemplate).toContain('{level}');
  });

  it('returns Swahili copy when language=sw', () => {
    expect(borjieMasteryGateCopy('sw').dismissAriaLabel).toBe('Funga kidokezo');
  });

  it('returns English copy when language=en', () => {
    expect(borjieMasteryGateCopy('en').dismissAriaLabel).toBe('Dismiss hint');
  });

  it('returns frozen object', () => {
    expect(Object.isFrozen(borjieMasteryGateCopy('sw'))).toBe(true);
  });
});

describe('borjieLearnedShortcutsHeadline', () => {
  it('returns Swahili headline', () => {
    expect(borjieLearnedShortcutsHeadline('sw')).toBe('Njia zako za mkato');
  });

  it('returns English headline', () => {
    expect(borjieLearnedShortcutsHeadline('en')).toBe('Your shortcuts');
  });
});
