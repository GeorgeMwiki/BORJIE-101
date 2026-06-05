import { describe, it, expect } from 'vitest';
import {
  levenshtein,
  matchNames,
  normalizePhone,
  matchPhones,
  matchAddresses,
  matchDates,
  matchAmounts,
  matchBankAccounts,
  reconcileDocBatch,
} from './fact-matcher.js';
import type { FactBag, MiningDocType } from './types.js';

describe('levenshtein', () => {
  it('is 0 for equal strings and counts edits', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('matchNames', () => {
  it('matches exact', () => {
    expect(matchNames(name('John Doe'), name('John Doe')).matched).toBe(true);
  });
  it('detects a first/last swap', () => {
    const r = matchNames(name('Doe John'), name('John Doe'));
    expect(r.matched).toBe(true);
    expect(r.swapDetected).toBe(true);
  });
  it('matches within Levenshtein threshold (OCR drift)', () => {
    expect(matchNames(name('Juma Mwita'), name('Juma Mwite')).matched).toBe(true);
  });
  it('matches initials to full name', () => {
    expect(matchNames(name('J M K'), name('Juma Mwita Kessy')).matched).toBe(true);
  });
  it('matches on middle-name presence/absence (subset)', () => {
    expect(matchNames(name('Juma Kessy'), name('Juma Mwita Kessy')).matched).toBe(true);
  });
  it('rejects completely different names', () => {
    expect(matchNames(name('Juma Kessy'), name('Asha Mollel')).matched).toBe(false);
  });
  it('rejects a token-subset that drops more than one name part (different people)', () => {
    // 'Juma Kessy' is a strict subset of 'Juma Hassan Kessy Mwita' (delta 2)
    // but two extra unexplained tokens make them plausibly different people.
    expect(matchNames(name('Juma Kessy'), name('Juma Hassan Kessy Mwita')).matched).toBe(false);
  });
});

describe('normalizePhone / matchPhones', () => {
  it('normalizes TZ formats to +255', () => {
    expect(normalizePhone('0712345678')).toBe('+255712345678');
    expect(normalizePhone('255712345678')).toBe('+255712345678');
    expect(normalizePhone('712345678')).toBe('+255712345678');
  });
  it('matches across formats', () => {
    expect(matchPhones('0712345678', '+255712345678')).toBe(true);
  });
  it('does not match different numbers', () => {
    expect(matchPhones('0712345678', '0787654321')).toBe(false);
  });
});

describe('matchAddresses', () => {
  it('matches similar addresses (fuzzy)', () => {
    const r = matchAddresses(
      { raw: 'P.O. Box 123, Geita, Geita Region' },
      { raw: 'PO Box 123 Geita Geita Region' },
    );
    expect(r.matched).toBe(true);
    expect(r.similarity).toBeGreaterThanOrEqual(0.6);
  });
  it('rejects dissimilar addresses', () => {
    const r = matchAddresses({ raw: 'Geita Town' }, { raw: 'Mwanza City Centre Block 9' });
    expect(r.matched).toBe(false);
  });
});

describe('matchDates', () => {
  it('honours exact / monthYear / year tolerance', () => {
    expect(matchDates('1990-05-10', '1990-05-10')).toBe(true);
    expect(matchDates('1990-05-10', '1990-05-22', 'monthYear')).toBe(true);
    expect(matchDates('1990-05-10', '1990-11-22', 'year')).toBe(true);
    expect(matchDates('1990-05-10', '1991-05-10')).toBe(false);
  });
  it('rejects non-ISO input', () => {
    expect(matchDates('10/05/1990', '10/05/1990')).toBe(false);
  });
});

describe('matchAmounts', () => {
  it('matches near-equal amounts within the 0.5% tolerance', () => {
    expect(matchAmounts(1_000_000, 1_002_000)).toBe(true); // 0.2% within 0.5%
    expect(matchAmounts(1_000_000, 1_004_000)).toBe(true); // 0.4% within 0.5%
  });
  it('rejects amounts beyond tolerance and non-positive amounts', () => {
    expect(matchAmounts(1_000_000, 1_100_000)).toBe(false); // 10% over
    expect(matchAmounts(0, 0)).toBe(false);
  });
});

describe('matchBankAccounts', () => {
  it('matches same bank + account', () => {
    expect(matchBankAccounts({ bank: 'BORJIE_BANK_1', accountNumber: '0012-3456' }, { bank: 'borjie_bank_1', accountNumber: '00123456' })).toBe(true);
  });
  it('rejects different banks', () => {
    expect(matchBankAccounts({ bank: 'B1', accountNumber: '1' }, { bank: 'B2', accountNumber: '1' })).toBe(false);
  });
});

describe('reconcileDocBatch', () => {
  it('returns trivially consistent for fewer than 2 docs', () => {
    const report = reconcileDocBatch([bag('d1', 'nida', { name: 'Juma Kessy' })]);
    expect(report.overallConsistency).toBe(1);
    expect(report.blockers).toHaveLength(0);
  });

  it('blocks on a STRICT national-id mismatch between high-confidence docs', () => {
    const report = reconcileDocBatch([
      bag('d1', 'nida', { name: 'Juma Kessy', nationalId: '19900510111122223333' }),
      bag('d2', 'mining-licence', { name: 'Juma Kessy', nationalId: '19900510999988887777' }),
    ]);
    expect(report.blockers.some((b) => b.field === 'nationalId')).toBe(true);
    expect(report.overallConsistency).toBeLessThan(1);
  });

  it('soft-flags a name mismatch but matches the shared phone', () => {
    const report = reconcileDocBatch([
      bag('d1', 'nida', { name: 'Juma Kessy', phone: '0712345678' }),
      bag('d2', 'bank-statement', { name: 'Asha Mollel', phone: '0712345678' }),
    ]);
    expect(report.blockers.some((b) => b.field === 'primaryName')).toBe(true);
    expect(report.matches.some((m) => m.field === 'phones')).toBe(true);
  });

  it('downgrades a name mismatch to SOFT when confidence is low', () => {
    const report = reconcileDocBatch([
      bag('d1', 'nida', { name: 'Juma Kessy' }, 0.5),
      bag('d2', 'passport', { name: 'Asha Mollel' }, 0.5),
    ]);
    expect(report.softFlags.some((s) => s.field === 'primaryName')).toBe(true);
    expect(report.blockers).toHaveLength(0);
  });

  it('soft-flags an amount conflict across royalty documents (lowers consistency)', () => {
    const matched = reconcileDocBatch([
      richBag('r1', 'royalty-receipt', { name: 'Juma Kessy', amount: 1_000_000 }),
      richBag('r2', 'royalty-receipt', { name: 'Juma Kessy', amount: 1_000_000 }),
    ]);
    const conflicting = reconcileDocBatch([
      richBag('r1', 'royalty-receipt', { name: 'Juma Kessy', amount: 1_000_000 }),
      richBag('r2', 'royalty-receipt', { name: 'Juma Kessy', amount: 2_500_000 }),
    ]);
    expect(conflicting.softFlags.some((f) => f.field === 'amount')).toBe(true);
    expect(conflicting.overallConsistency).toBeLessThan(matched.overallConsistency);
  });

  it('blocks on a different payout bank account across documents', () => {
    const report = reconcileDocBatch([
      richBag('b1', 'bank-statement', { name: 'Juma Kessy', bank: { bank: 'CRDB', accountNumber: '0150123456' } }),
      richBag('b2', 'royalty-receipt', { name: 'Juma Kessy', bank: { bank: 'CRDB', accountNumber: '0150999999' } }),
    ]);
    expect(report.blockers.some((b) => b.field === 'bankAccounts')).toBe(true);
    expect(report.overallConsistency).toBeLessThan(1);
  });

  it('matches a fuzzy address across documents (raises consistency, no flag)', () => {
    const report = reconcileDocBatch([
      richBag('a1', 'nida', { name: 'Juma Kessy', address: 'P.O. Box 123, Geita, Geita Region' }),
      richBag('a2', 'lease-agreement', { name: 'Juma Kessy', address: 'PO Box 123 Geita Geita Region' }),
    ]);
    expect(report.matches.some((m) => m.field === 'addresses')).toBe(true);
    expect(report.softFlags.some((f) => f.field === 'addresses')).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function name(full: string) {
  const parts = full.split(' ');
  return { first: parts[0] ?? full, last: parts[parts.length - 1] ?? full, full: full.toUpperCase() };
}

function richBag(
  id: string,
  docType: MiningDocType,
  fields: {
    name?: string;
    amount?: number;
    bank?: { bank: string; accountNumber: string };
    address?: string;
  },
  conf = 1,
): FactBag {
  return {
    ...(fields.name ? { primaryName: name(fields.name) } : {}),
    ...(fields.amount !== undefined ? { amount: fields.amount } : {}),
    phones: [],
    addresses: fields.address ? [{ raw: fields.address }] : [],
    bankAccounts: fields.bank ? [fields.bank] : [],
    sourceDocId: id,
    sourceDocType: docType,
    fieldConfidences: {
      primaryName: conf,
      dateOfBirth: conf,
      nationalId: conf,
      tin: conf,
      phones: conf,
      addresses: conf,
      bankAccounts: conf,
      amount: conf,
    },
  };
}

function bag(
  id: string,
  docType: MiningDocType,
  fields: { name?: string; nationalId?: string; phone?: string },
  conf = 1,
): FactBag {
  return {
    ...(fields.name ? { primaryName: name(fields.name) } : {}),
    ...(fields.nationalId ? { nationalId: fields.nationalId } : {}),
    phones: fields.phone ? [fields.phone] : [],
    addresses: [],
    bankAccounts: [],
    sourceDocId: id,
    sourceDocType: docType,
    fieldConfidences: {
      primaryName: conf,
      dateOfBirth: conf,
      nationalId: conf,
      tin: conf,
      phones: conf,
      addresses: conf,
      bankAccounts: conf,
      amount: conf,
    },
  };
}
