import { describe, expect, it } from 'vitest';
import { skipToMain } from '../accessibility-helpers.js';

describe('accessibility-helpers: skipToMain (pure helper)', () => {
  it('returns href pointing to provided id', () => {
    const props = skipToMain('content');
    expect(props.href).toBe('#content');
  });

  it('defaults href to #main', () => {
    expect(skipToMain().href).toBe('#main');
  });

  it('default label is descriptive', () => {
    expect(skipToMain().children).toMatch(/skip/i);
  });

  it('className includes sr-only + focus visibility', () => {
    const c = skipToMain().className;
    expect(c).toContain('sr-only');
    expect(c).toContain('focus:not-sr-only');
  });

  it('respects custom label', () => {
    expect(skipToMain('m', 'Skip').children).toBe('Skip');
  });
});

// Note: createFocusTrap + createAriaAnnouncer touch the DOM and are
// covered by an apps-level integration test using vitest+happy-dom.
// We assert here only that they are exported.
import {
  createAriaAnnouncer,
  createFocusTrap,
  findFocusable,
} from '../accessibility-helpers.js';

describe('accessibility-helpers: exports', () => {
  it('createFocusTrap is a function', () => {
    expect(typeof createFocusTrap).toBe('function');
  });
  it('createAriaAnnouncer is a function', () => {
    expect(typeof createAriaAnnouncer).toBe('function');
  });
  it('findFocusable is a function', () => {
    expect(typeof findFocusable).toBe('function');
  });
});
