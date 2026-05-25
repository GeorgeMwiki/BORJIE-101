/**
 * CoT-reservoir PII-scrubber regression coverage.
 *
 * Closes the Wave-K Fix-Agent C false-positive: the `phone-gen` pattern
 * used to match any 10-digit identifier starting with `06`/`07`, which
 * silently mangled invoice numbers like `INV-0712345678`. The patch
 * tightens the formatted-variant regex to require a consistent
 * separator AND adds a cue-anchored fallback for bare 10-digit
 * mobiles, so real phones still get scrubbed without dragging
 * invoice IDs along with them.
 */

import { describe, it, expect } from 'vitest';
import { scrubCotText } from '../cot-reservoir.js';

describe('scrubCotText — phone-gen false-positive fix', () => {
  it('scrubs a formatted local mobile with spaces (0712 345 678)', () => {
    const { sanitized, mutations } = scrubCotText('Reach me at 0712 345 678 today.');
    expect(sanitized).toBe('Reach me at [redacted-phone] today.');
    expect(mutations).toContain('scrubbed:phone-gen');
  });

  it('scrubs a formatted local mobile with hyphens (0712-345-678)', () => {
    const { sanitized, mutations } = scrubCotText('Tenant phone is 0712-345-678.');
    // Either pattern can fire first — both end at the same redaction.
    expect(sanitized).toMatch(/\[redacted-phone\]/);
    expect(sanitized).not.toContain('0712-345-678');
    expect(mutations.length).toBeGreaterThan(0);
  });

  it('scrubs a bare 10-digit mobile when preceded by a phone cue word (phone: 0712345678)', () => {
    const { sanitized, mutations } = scrubCotText('phone: 0712345678');
    expect(sanitized).toBe('[redacted-phone]');
    expect(mutations).toContain('scrubbed:phone-cue');
  });

  it('does NOT scrub a bare 10-digit invoice identifier (INV-0712345678)', () => {
    const { sanitized, mutations } = scrubCotText('Invoice number is INV-0712345678 (overdue).');
    // The 10-digit ID must survive — it is not a phone in any sense.
    expect(sanitized).toContain('0712345678');
    expect(mutations).not.toContain('scrubbed:phone-gen');
    expect(mutations).not.toContain('scrubbed:phone-cue');
  });

  it('does NOT scrub a bare 10-digit identifier in a non-phone context', () => {
    const { sanitized, mutations } = scrubCotText(
      'Reference number 0712345678 was filed yesterday.',
    );
    expect(sanitized).toContain('0712345678');
    expect(mutations).not.toContain('scrubbed:phone-gen');
    expect(mutations).not.toContain('scrubbed:phone-cue');
  });

  it('still scrubs full international Tanzania and Kenya mobiles (regression)', () => {
    const tz = scrubCotText('Call +255 712 345 678 ASAP.');
    const ke = scrubCotText('WhatsApp +254 712 345 678 please.');
    expect(tz.sanitized).toContain('[redacted-phone]');
    expect(ke.sanitized).toContain('[redacted-phone]');
  });
});
