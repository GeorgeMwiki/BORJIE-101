/**
 * PCCB + PDPA resolver tests.
 *
 * Wave BRAIN-DEPTH. Drives the resolvers with an in-memory db stub so
 * the tone derivation logic is asserted without a real Postgres.
 */

import { describe, it, expect, vi } from 'vitest';

import { resolvePccb, summarisePccb } from '../pccb-resolver';
import { resolvePdpa, summarisePdpa } from '../pdpa-resolver';

function singleRowDb(row: Record<string, unknown>) {
  return {
    execute: vi.fn(async () => [row]),
  };
}

function emptyDb() {
  return { execute: vi.fn(async () => []) };
}

describe('resolvePccb', () => {
  it('returns red when zero disclosures on file', async () => {
    const db = singleRowDb({
      records_count: 0,
      overdue_count: 0,
      last_filed_at: null,
    });
    const out = await resolvePccb({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('red');
  });

  it('returns green when recent disclosures with no overdue', async () => {
    const db = singleRowDb({
      records_count: 3,
      overdue_count: 0,
      last_filed_at: new Date().toISOString(),
    });
    const out = await resolvePccb({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('green');
  });

  it('returns amber when there are overdue rows', async () => {
    const db = singleRowDb({
      records_count: 3,
      overdue_count: 2,
      last_filed_at: new Date().toISOString(),
    });
    const out = await resolvePccb({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('amber');
  });

  it('returns unknown when DB is missing', async () => {
    const summary = await summarisePccb(
      { db: null },
      { tenantId: 'tenant-a' },
    );
    expect(summary.status).toBe('unknown');
  });
});

describe('resolvePdpa', () => {
  function pdpaDb(proc: Record<string, unknown>, req: Record<string, unknown>) {
    let i = 0;
    return {
      execute: vi.fn(async () => {
        const v = i === 0 ? [proc] : [req];
        i += 1;
        return v;
      }),
    };
  }

  it('returns red when there are no processing records', async () => {
    const db = pdpaDb(
      { records_count: 0, with_dpia: 0, last_review_at: null },
      { open_count: 0, overdue_count: 0 },
    );
    const out = await resolvePdpa({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('red');
  });

  it('returns green with full coverage, recent review, no overdue', async () => {
    const db = pdpaDb(
      {
        records_count: 5,
        with_dpia: 5,
        last_review_at: new Date().toISOString(),
      },
      { open_count: 0, overdue_count: 0 },
    );
    const out = await resolvePdpa({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('green');
  });

  it('returns red when many overdue requests', async () => {
    const db = pdpaDb(
      {
        records_count: 5,
        with_dpia: 5,
        last_review_at: new Date().toISOString(),
      },
      { open_count: 10, overdue_count: 4 },
    );
    const out = await resolvePdpa({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('red');
  });

  it('returns amber when coverage is in the 0.4..0.8 band', async () => {
    const db = pdpaDb(
      {
        records_count: 10,
        with_dpia: 5,
        last_review_at: new Date().toISOString(),
      },
      { open_count: 0, overdue_count: 0 },
    );
    const out = await resolvePdpa({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('amber');
  });

  it('returns unknown when DB is missing', async () => {
    const summary = await summarisePdpa(
      { db: null },
      { tenantId: 'tenant-a' },
    );
    expect(summary.status).toBe('unknown');
  });

  it('never throws when db.execute rejects', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const out = await resolvePdpa({ db }, { tenantId: 'tenant-a' });
    expect(out.status).toBe('unknown');
  });
});
