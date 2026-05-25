/**
 * pii-mask — unit tests.
 *
 * Pins the selector list + scrub patterns rrweb leans on. The selector
 * is verified against synthetic DOM nodes spun up via jsdom.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDefaultMaskConfig,
  DEFAULT_MASK_TEXT_SELECTOR,
  isPiiElement,
  scrubPiiPatterns,
} from '../pii-mask';

describe('buildDefaultMaskConfig', () => {
  it('returns maskAllInputs=true (PostHog default)', () => {
    const cfg = buildDefaultMaskConfig();
    expect(cfg.maskAllInputs).toBe(true);
  });

  it('includes the canonical selector list', () => {
    const cfg = buildDefaultMaskConfig();
    expect(cfg.maskTextSelector).toBe(DEFAULT_MASK_TEXT_SELECTOR);
    expect(cfg.maskTextSelector).toContain('[data-pii]');
    expect(cfg.maskTextSelector).toContain('input[type="password"]');
  });

  it('masked input fn collapses every char to *', () => {
    const cfg = buildDefaultMaskConfig();
    const masked = cfg.maskInputFn!('secret-pw');
    expect(masked).toBe('*********');
  });
});

describe('isPiiElement', () => {
  it('flags an element with data-pii', () => {
    const div = document.createElement('div');
    div.setAttribute('data-pii', 'true');
    expect(isPiiElement(div)).toBe(true);
  });

  it('flags <input type="password">', () => {
    const input = document.createElement('input');
    input.type = 'password';
    expect(isPiiElement(input)).toBe(true);
  });

  it('flags <input type="tel">', () => {
    const input = document.createElement('input');
    input.type = 'tel';
    expect(isPiiElement(input)).toBe(true);
  });

  it('does NOT flag a plain div', () => {
    const div = document.createElement('div');
    expect(isPiiElement(div)).toBe(false);
  });

  it('handles null safely', () => {
    expect(isPiiElement(null)).toBe(false);
  });
});

describe('scrubPiiPatterns', () => {
  it('redacts a credit-card number', () => {
    const out = scrubPiiPatterns('My card is 4242 4242 4242 4242 please bill it');
    expect(out).not.toContain('4242 4242 4242 4242');
    expect(out).toContain('•');
  });

  it('redacts a TZ phone number', () => {
    const out = scrubPiiPatterns('call +255 712 345 678 today');
    expect(out).not.toContain('+255 712 345 678');
  });

  it('redacts a KRA PIN', () => {
    const out = scrubPiiPatterns('PIN A123456789B issued today');
    expect(out).not.toContain('A123456789B');
  });

  it('leaves prose intact', () => {
    const out = scrubPiiPatterns('Rent is due on Friday for unit 4B');
    expect(out).toBe('Rent is due on Friday for unit 4B');
  });

  it('handles empty input', () => {
    expect(scrubPiiPatterns('')).toBe('');
  });
});
