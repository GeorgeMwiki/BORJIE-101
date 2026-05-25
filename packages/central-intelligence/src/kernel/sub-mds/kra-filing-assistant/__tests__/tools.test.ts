import { describe, expect, it } from 'vitest';
import { compileMriBatch, type RentalIncomeRecord } from '../tools/compile-mri-batch.js';
import { validatePreFiling } from '../tools/validate-pre-filing.js';
import { draftFiling } from '../tools/draft-filing.js';
import { fetchFilingStatus, type FilingStatusPort } from '../tools/fetch-filing-status.js';

const OWNER = 'own-1';
const PIN = 'A012345678B';

function mkRec(part: Partial<RentalIncomeRecord> = {}): RentalIncomeRecord {
  return {
    ownerId: OWNER,
    tenantId: 't1',
    tenantName: 'Asha',
    tenantKraPin: 'A987654321B',
    propertyId: 'p1',
    propertyAddress: 'Block A 4B',
    receivedAtMs: Date.UTC(2026, 3, 15),
    grossRentMinor: 50000_00,
    withholdingMinor: 5000_00,
    currency: 'KES',
    ...part,
  };
}

describe('compileMriBatch', () => {
  it('aggregates lines for the named owner + period', () => {
    const b = compileMriBatch({
      ownerId: OWNER,
      ownerKraPin: PIN,
      periodYear: 2026,
      periodMonth: 4,
      records: [
        mkRec(),
        mkRec({ tenantId: 't2', tenantName: 'Brian', propertyId: 'p2', propertyAddress: 'Block B 1A', grossRentMinor: 60000_00, withholdingMinor: 6000_00 }),
      ],
    });
    expect(b.totals.lineCount).toBe(2);
    expect(b.totals.tenantCount).toBe(2);
    expect(b.totals.propertyCount).toBe(2);
    expect(b.totals.grossRentMinor).toBe(110000_00);
    expect(b.totals.withholdingMinor).toBe(11000_00);
  });

  it('drops cross-owner records to outOfScope', () => {
    const b = compileMriBatch({
      ownerId: OWNER,
      ownerKraPin: PIN,
      periodYear: 2026,
      periodMonth: 4,
      records: [
        mkRec(),
        mkRec({ ownerId: 'other-owner' }),
      ],
    });
    expect(b.lines.length).toBe(1);
    expect(b.outOfScope.length).toBe(1);
    expect(b.outOfScope[0]?.reason).toBe('cross-owner');
  });

  it('drops wrong-period records', () => {
    const b = compileMriBatch({
      ownerId: OWNER,
      ownerKraPin: PIN,
      periodYear: 2026,
      periodMonth: 4,
      records: [
        mkRec(),
        mkRec({ receivedAtMs: Date.UTC(2026, 4, 1) }), // May 1, out of April
      ],
    });
    expect(b.lines.length).toBe(1);
    expect(b.outOfScope[0]?.reason).toBe('wrong-period');
  });
});

describe('validatePreFiling', () => {
  it('passes a clean batch', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4,
      records: [mkRec()],
    });
    const v = validatePreFiling(b);
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
  });

  it('flags malformed owner PIN', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: 'BADPIN', periodYear: 2026, periodMonth: 4,
      records: [mkRec()],
    });
    const v = validatePreFiling(b);
    expect(v.ok).toBe(false);
    expect(v.issues.find(i => i.code === 'malformed-owner-pin')).toBeDefined();
  });

  it('flags withholding > gross', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4,
      records: [mkRec({ withholdingMinor: 99999_00, grossRentMinor: 50000_00 })],
    });
    const v = validatePreFiling(b);
    expect(v.ok).toBe(false);
    expect(v.issues.find(i => i.code === 'withholding-exceeds-gross')).toBeDefined();
  });

  it('warns on missing tenant PIN but stays ok', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4,
      records: [mkRec({ tenantKraPin: undefined })],
    });
    const v = validatePreFiling(b);
    expect(v.ok).toBe(true);
    expect(v.warnCount).toBeGreaterThan(0);
    expect(v.issues.find(i => i.code === 'missing-tenant-pin')).toBeDefined();
  });

  it('blocks an empty batch', () => {
    const b = compileMriBatch({ ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4, records: [] });
    const v = validatePreFiling(b);
    expect(v.ok).toBe(false);
    expect(v.issues.find(i => i.code === 'empty-batch')).toBeDefined();
  });

  it('flags currency mismatch', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4,
      records: [mkRec(), mkRec({ tenantId: 't2', currency: 'TZS' })],
    });
    const v = validatePreFiling(b);
    expect(v.issues.find(i => i.code === 'currency-mismatch')).toBeDefined();
  });
});

describe('draftFiling', () => {
  it('produces a queued draft when validation passes', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: PIN, periodYear: 2026, periodMonth: 4,
      records: [mkRec()],
    });
    const v = validatePreFiling(b);
    const d = draftFiling({ batch: b, validation: v });
    expect(d.draftStatus).toBe('queued-for-owner-review');
    expect(d.schemaVersion).toBe('kra-erits-v1');
    expect(d.lines.length).toBe(1);
    expect(d.nextStepGuidance).toContain('platform.file_kra_mri');
  });

  it('blocks when validation fails', () => {
    const b = compileMriBatch({
      ownerId: OWNER, ownerKraPin: 'BAD', periodYear: 2026, periodMonth: 4,
      records: [mkRec()],
    });
    const v = validatePreFiling(b);
    const d = draftFiling({ batch: b, validation: v });
    expect(d.draftStatus).toBe('blocked-validation-failed');
    expect(d.nextStepGuidance).toContain('validation errors');
  });
});

describe('fetchFilingStatus', () => {
  it('archive-receipt on accepted', async () => {
    const port: FilingStatusPort = {
      async readStatus() {
        return { status: 'accepted', receiptNumber: 'KRA-12345', fetchedAtMs: 1000 };
      },
    };
    const r = await fetchFilingStatus({ port, ownerPin: PIN, periodYear: 2026, periodMonth: 4 });
    expect(r.suggestedOwnerAction).toBe('archive-receipt');
    expect(r.receiptNumber).toBe('KRA-12345');
  });

  it('investigate-rejection on rejected', async () => {
    const port: FilingStatusPort = {
      async readStatus() {
        return { status: 'rejected', rejectionReason: 'PIN mismatch', fetchedAtMs: 1000 };
      },
    };
    const r = await fetchFilingStatus({ port, ownerPin: PIN, periodYear: 2026, periodMonth: 4 });
    expect(r.suggestedOwnerAction).toBe('investigate-rejection');
    expect(r.rejectionReason).toBe('PIN mismatch');
  });

  it('submit-amendment on amendment-requested', async () => {
    const port: FilingStatusPort = {
      async readStatus() {
        return { status: 'amendment-requested', amendmentInstructions: 'Add 1 tenant', fetchedAtMs: 1000 };
      },
    };
    const r = await fetchFilingStatus({ port, ownerPin: PIN, periodYear: 2026, periodMonth: 4 });
    expect(r.suggestedOwnerAction).toBe('submit-amendment');
  });
});
