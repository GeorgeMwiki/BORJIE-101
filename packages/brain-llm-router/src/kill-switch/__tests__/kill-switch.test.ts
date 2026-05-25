/**
 * Tests for `kill-switch.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildKillSwitchPrompt,
  isKillSwitchActive,
  resetKillSwitchDbReader,
  setKillSwitchDbReader,
} from '../kill-switch.js';

const originalEnv = process.env.BORJIE_AI_KILL_SWITCH;

beforeEach(() => {
  delete process.env.BORJIE_AI_KILL_SWITCH;
  resetKillSwitchDbReader();
  // Strip localStorage if any
  if (typeof globalThis !== 'undefined') {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.BORJIE_AI_KILL_SWITCH = originalEnv;
  } else {
    delete process.env.BORJIE_AI_KILL_SWITCH;
  }
  resetKillSwitchDbReader();
  if (typeof globalThis !== 'undefined') {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe('isKillSwitchActive — clean state', () => {
  it('returns false with no flags active', () => {
    expect(isKillSwitchActive()).toBe(false);
  });
});

describe('isKillSwitchActive — DB flag (explicit)', () => {
  it('returns true when dbFlag arg is true', () => {
    expect(isKillSwitchActive(true)).toBe(true);
  });

  it('returns false when dbFlag arg is false', () => {
    expect(isKillSwitchActive(false)).toBe(false);
  });

  it('returns false when dbFlag arg is null', () => {
    expect(isKillSwitchActive(null)).toBe(false);
  });
});

describe('isKillSwitchActive — DB reader injection', () => {
  it('returns true when injected reader returns true (no arg)', () => {
    setKillSwitchDbReader(() => true);
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns false when injected reader returns false', () => {
    setKillSwitchDbReader(() => false);
    expect(isKillSwitchActive()).toBe(false);
  });

  it('explicit dbFlag arg overrides injected reader', () => {
    setKillSwitchDbReader(() => true);
    // Explicit `false` does NOT win — DB true still kills; only an
    // explicit `true` short-circuits early. But injected reader is
    // only consulted when dbFlag is undefined.
    expect(isKillSwitchActive(false)).toBe(false);
  });
});

describe('isKillSwitchActive — env var', () => {
  it('returns true for "true"', () => {
    process.env.BORJIE_AI_KILL_SWITCH = 'true';
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns true for "1"', () => {
    process.env.BORJIE_AI_KILL_SWITCH = '1';
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns true for "yes"', () => {
    process.env.BORJIE_AI_KILL_SWITCH = 'yes';
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns false for "0" / "false"', () => {
    process.env.BORJIE_AI_KILL_SWITCH = '0';
    expect(isKillSwitchActive()).toBe(false);
    process.env.BORJIE_AI_KILL_SWITCH = 'false';
    expect(isKillSwitchActive()).toBe(false);
  });

  it('returns false for empty env value', () => {
    process.env.BORJIE_AI_KILL_SWITCH = '';
    expect(isKillSwitchActive()).toBe(false);
  });
});

describe('isKillSwitchActive — localStorage', () => {
  it('returns true when localStorage flag is "1"', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => (k === 'borjie_ai_kill_switch' ? '1' : null),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(isKillSwitchActive()).toBe(true);
  });

  it('returns false when localStorage getItem throws', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    // Conservative fallback — never crash the LLM path.
    expect(isKillSwitchActive()).toBe(false);
  });
});

describe('buildKillSwitchPrompt', () => {
  it('returns the English variant', () => {
    const out = buildKillSwitchPrompt('en');
    expect(out).toContain('Borjie');
    expect(out).toContain('maintenance');
    expect(out).not.toContain('—'); // no em-dash
  });

  it('returns the Swahili variant', () => {
    const out = buildKillSwitchPrompt('sw');
    expect(out).toContain('Borjie');
    expect(out).toContain('matengenezo');
    expect(out).not.toContain('—'); // no em-dash
  });

  it('language variants are different', () => {
    expect(buildKillSwitchPrompt('en')).not.toBe(buildKillSwitchPrompt('sw'));
  });
});
