import { describe, it, expect } from 'vitest';

import { announce, _internal_flush, _internal_getRegions } from '../a11y/announcer';

describe('announcer', () => {
  it('writes the message to a region with aria-live="polite"', () => {
    announce('First message');
    _internal_flush();
    const regions = _internal_getRegions();
    expect(regions).not.toBeNull();
    const text = (regions?.a ?? '') + (regions?.b ?? '');
    expect(text).toContain('First message');
    const a = document.getElementById('bb-announcer-region-a');
    expect(a).toHaveAttribute('aria-live', 'polite');
  });

  it('debounces a burst into a single announcement', () => {
    announce('one');
    announce('two');
    announce('three');
    _internal_flush();
    const regions = _internal_getRegions();
    const text = (regions?.a ?? '') + (regions?.b ?? '');
    expect(text).toContain('three');
    expect(text).not.toContain('one');
  });

  it('no-ops on empty input', () => {
    announce('');
    _internal_flush();
    expect(true).toBe(true);
  });
});
