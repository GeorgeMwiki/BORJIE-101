/**
 * Extended PII patterns — Wave-K Tier-3 W-Ops.
 *
 * The 5 new patterns (Luhn credit-card, IBAN, US SSN, UK NI, GPS coords)
 * are flag-gated behind `BORJIE_PII_EXTENDED=1`. Default off keeps
 * the EAT-first baseline; this suite drives the flag on/off and
 * confirms each pattern fires correctly under the flag while every
 * baseline scrub keeps working with the flag set to either state.
 *
 * 6+ tests per pattern:
 *   - happy path (valid input) → scrubbed
 *   - validator-rejected (e.g. failing Luhn / mod-97 / SSA sentinel)
 *   - flag-off → NOT scrubbed
 *   - false-positive context (number embedded in unrelated string)
 *   - boundary case (max length, edge of valid range)
 *   - mutations array includes the right kind tag
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  scrubCotText,
  luhnValid,
  ibanValid,
  extendedPiiEnabled,
} from '../cot-reservoir.js';

const FLAG = 'BORJIE_PII_EXTENDED';
let originalFlag: string | undefined;

function enableExtended(): void {
  process.env[FLAG] = '1';
}
function disableExtended(): void {
  delete process.env[FLAG];
}

beforeEach(() => {
  originalFlag = process.env[FLAG];
  delete process.env[FLAG];
});
afterEach(() => {
  if (originalFlag !== undefined) {
    process.env[FLAG] = originalFlag;
  } else {
    delete process.env[FLAG];
  }
});

// ---------------------------------------------------------------------------
// Flag gate
// ---------------------------------------------------------------------------

describe('extendedPiiEnabled', () => {
  it('returns false when the flag is unset', () => {
    expect(extendedPiiEnabled({})).toBe(false);
  });
  it('returns true for value "1"', () => {
    expect(extendedPiiEnabled({ [FLAG]: '1' })).toBe(true);
  });
  it('returns true for value "true"', () => {
    expect(extendedPiiEnabled({ [FLAG]: 'true' })).toBe(true);
  });
  it('returns true for value "yes"', () => {
    expect(extendedPiiEnabled({ [FLAG]: 'YES' })).toBe(true);
  });
  it('returns false for value "0"', () => {
    expect(extendedPiiEnabled({ [FLAG]: '0' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Luhn credit-card
// ---------------------------------------------------------------------------

describe('extended PII — credit-card-luhn', () => {
  it('luhnValid returns true for a valid Visa test number', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
  });
  it('luhnValid returns true for a valid Amex 15-digit test number', () => {
    expect(luhnValid('378282246310005')).toBe(true);
  });
  it('luhnValid returns false for a 16-digit fail-checksum string', () => {
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
  });
  it('luhnValid rejects 12 digits (too short)', () => {
    expect(luhnValid('411111111111')).toBe(false);
  });

  it('scrubs a Luhn-valid card number when flag is ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText(
      'My card is 4111 1111 1111 1111 — please charge.',
    );
    expect(sanitized).not.toContain('4111 1111 1111 1111');
    expect(sanitized).toContain('[redacted-card]');
    expect(mutations).toContain('scrubbed:credit-card-luhn');
  });

  it('does NOT scrub a Luhn-invalid 16-digit string even with flag ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText(
      'Reference run 1234567890123456 has been logged.',
    );
    expect(sanitized).toContain('1234567890123456');
    expect(mutations).not.toContain('scrubbed:credit-card-luhn');
  });

  it('does NOT scrub a valid card number when the flag is OFF', () => {
    disableExtended();
    const { sanitized, mutations } = scrubCotText(
      'My card is 4111 1111 1111 1111 — please charge.',
    );
    expect(sanitized).toContain('4111 1111 1111 1111');
    expect(mutations).not.toContain('scrubbed:credit-card-luhn');
  });
});

// ---------------------------------------------------------------------------
// IBAN
// ---------------------------------------------------------------------------

describe('extended PII — iban', () => {
  it('ibanValid returns true for a real GB IBAN', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
  });
  it('ibanValid returns true for a real DE IBAN', () => {
    expect(ibanValid('DE89370400440532013000')).toBe(true);
  });
  it('ibanValid returns false for a wrong check-digit', () => {
    expect(ibanValid('GB99 WEST 1234 5698 7654 32')).toBe(false);
  });
  it('ibanValid rejects too-short input', () => {
    expect(ibanValid('GB82')).toBe(false);
  });

  it('scrubs a valid IBAN when flag is ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText(
      'Transfer to GB82WEST12345698765432 by 5pm.',
    );
    expect(sanitized).not.toContain('GB82WEST12345698765432');
    expect(sanitized).toContain('[redacted-iban]');
    expect(mutations).toContain('scrubbed:iban');
  });

  it('does NOT scrub an iban-shaped string with bad checksum', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText('Lookup AA00ZZZZ12345678');
    expect(mutations).not.toContain('scrubbed:iban');
    expect(sanitized).toContain('AA00ZZZZ12345678');
  });

  it('does NOT scrub a valid IBAN when the flag is OFF', () => {
    disableExtended();
    const { sanitized } = scrubCotText(
      'Transfer to GB82WEST12345698765432 by 5pm.',
    );
    expect(sanitized).toContain('GB82WEST12345698765432');
  });
});

// ---------------------------------------------------------------------------
// US SSN
// ---------------------------------------------------------------------------

describe('extended PII — ssn-us', () => {
  it('scrubs a standard SSN when flag is ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText('SSN 123-45-6789 confirmed.');
    expect(sanitized).toBe('SSN [redacted-ssn] confirmed.');
    expect(mutations).toContain('scrubbed:ssn-us');
  });
  it('does NOT scrub a 000-prefixed SSN (never issued)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('SSN 000-12-3456 was rejected.');
    expect(sanitized).toContain('000-12-3456');
  });
  it('does NOT scrub a 666-prefixed SSN (never issued)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('SSN 666-12-3456 was rejected.');
    expect(sanitized).toContain('666-12-3456');
  });
  it('does NOT scrub an SSN when the flag is OFF', () => {
    disableExtended();
    const { sanitized } = scrubCotText('SSN 123-45-6789 confirmed.');
    expect(sanitized).toContain('123-45-6789');
  });
  it('does NOT scrub a 7-digit phone fragment like 555-12-34 (wrong shape)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('555-12-34');
    expect(sanitized).toBe('555-12-34');
  });
  it('does NOT scrub when middle group is "00"', () => {
    enableExtended();
    const { sanitized } = scrubCotText('123-00-6789');
    expect(sanitized).toContain('123-00-6789');
  });
});

// ---------------------------------------------------------------------------
// UK NI
// ---------------------------------------------------------------------------

describe('extended PII — ni-uk', () => {
  it('scrubs a valid NI number when flag is ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText('NI: AB123456C registered.');
    expect(sanitized).toBe('NI: [redacted-ni] registered.');
    expect(mutations).toContain('scrubbed:ni-uk');
  });
  it('scrubs a valid NI with prefix at letter boundaries (CR789012D)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('NI CR789012D');
    expect(sanitized).toContain('[redacted-ni]');
  });
  it('does NOT scrub a sequence with banned letter Q in 1st position', () => {
    enableExtended();
    const { sanitized } = scrubCotText('QB123456C is the placeholder.');
    expect(sanitized).toContain('QB123456C');
  });
  it('does NOT scrub when last char is E (not A-D)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('AB123456E filed.');
    expect(sanitized).toContain('AB123456E');
  });
  it('does NOT scrub a valid NI when flag is OFF', () => {
    disableExtended();
    const { sanitized } = scrubCotText('NI: AB123456C registered.');
    expect(sanitized).toContain('AB123456C');
  });
  it('does NOT scrub a 7-digit run with letters around', () => {
    enableExtended();
    const { sanitized } = scrubCotText('XY12 34567');
    expect(sanitized).toBe('XY12 34567');
  });
});

// ---------------------------------------------------------------------------
// GPS coords
// ---------------------------------------------------------------------------

describe('extended PII — gps-coords', () => {
  it('scrubs a Dar-es-Salaam decimal-degree pair when flag is ON', () => {
    enableExtended();
    const { sanitized, mutations } = scrubCotText('Apartment at -6.7924, 39.2083.');
    expect(sanitized).toBe('Apartment at [redacted-gps].');
    expect(mutations).toContain('scrubbed:gps-coords');
  });
  it('scrubs a 0,0 pair', () => {
    enableExtended();
    const { sanitized } = scrubCotText('Default origin: 0, 0.');
    expect(sanitized).toContain('[redacted-gps]');
  });
  it('scrubs a max lat / max lng pair (90, 180)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('Pole edge: 90, 180.');
    expect(sanitized).toContain('[redacted-gps]');
  });
  it('does NOT scrub an out-of-range lat (91.0, 0.0)', () => {
    enableExtended();
    const { sanitized } = scrubCotText('Invalid: 91.0, 0.0');
    expect(sanitized).toContain('91.0, 0.0');
  });
  it('does NOT scrub when flag is OFF', () => {
    disableExtended();
    const { sanitized } = scrubCotText('Apartment at -6.7924, 39.2083.');
    expect(sanitized).toContain('-6.7924, 39.2083');
  });
  it('does NOT scrub an integer pair that is part of a larger number stream', () => {
    enableExtended();
    // "100,200" — 100 is out of valid lat range (>90) so the validator
    // refuses. The lookbehind also prevents matching inside the larger
    // 1000,200 case.
    const { sanitized } = scrubCotText('Page count: 100,200 books');
    expect(sanitized).toContain('100,200');
  });
});

// ---------------------------------------------------------------------------
// Baseline (EAT) patterns must still work when extended set is ON.
// ---------------------------------------------------------------------------

describe('extended PII — baseline still runs when flag is ON', () => {
  it('TZ phone is still redacted', () => {
    enableExtended();
    const { sanitized } = scrubCotText('Reach me at +255 712 345 678.');
    expect(sanitized).toContain('[redacted-phone]');
  });
  it('email is still redacted', () => {
    enableExtended();
    const { sanitized } = scrubCotText('Send to user@example.com');
    expect(sanitized).toContain('[redacted-email]');
  });
  it('NIDA is still redacted', () => {
    enableExtended();
    const { sanitized } = scrubCotText('NIDA 12345678-12345-12345-01 verified.');
    expect(sanitized).toContain('[redacted-nida]');
  });
});
