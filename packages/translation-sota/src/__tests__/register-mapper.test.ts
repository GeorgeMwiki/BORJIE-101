/**
 * Register preservation tests.
 *
 * Covers:
 *   - Formal Swahili ("Ndugu, …") is detected as formal + the honorific
 *     is captured.
 *   - `applyRegister` prepends the formal English opener when the
 *     provider's output is missing one.
 *   - `applyRegister` is idempotent when the opener is already
 *     present.
 *   - Neutral input is left untouched.
 */

import { describe, expect, it } from 'vitest';
import { applyRegister, detectRegister } from '../register/register-mapper.js';

describe('register mapper', () => {
  it('detects formal Swahili register via the "Ndugu" honorific', () => {
    const reg = detectRegister('Ndugu, parseli imefika.', 'sw');
    expect(reg.level).toBe('formal');
    expect(reg.honorific).toBe('ndugu');
  });

  it('falls back to neutral when no honorific or polite marker fires', () => {
    const reg = detectRegister('Parseli imefika.', 'sw');
    expect(reg.level).toBe('neutral');
    expect(reg.honorific).toBeUndefined();
  });

  it('prepends a formal English opener when missing on the target side', () => {
    const reg = detectRegister('Ndugu, parseli imefika.', 'sw');
    const result = applyRegister('The parcel has arrived.', reg, 'en');
    expect(result.toLowerCase()).toContain('dear sir or madam');
    expect(result).toContain('The parcel has arrived.');
  });

  it('is idempotent — never double-prepends when opener already present', () => {
    const reg = detectRegister('Ndugu, parseli imefika.', 'sw');
    const already = 'Dear sir or madam, the parcel has arrived.';
    const result = applyRegister(already, reg, 'en');
    expect(result).toBe(already);
  });
});
