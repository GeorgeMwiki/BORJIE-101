/**
 * loadCapturedKyb — the B1 commit seam reads the most-recent onboarding run's
 * captured KYB so the company can be materialised before the licence commit.
 *
 * These tests pin the read contract (tenant-scoped, latest run, valid KYB
 * shape) WITHOUT a live Postgres: a fake `execute` returns the
 * `steps -> 'kyb' -> 'payload'` blob the route would read.
 */
import { describe, expect, it, vi } from 'vitest';
import { __TEST_ONLY } from '../onboarding.hono';

const { loadCapturedKyb } = __TEST_ONLY as unknown as {
  loadCapturedKyb: (
    db: { execute(q: unknown): Promise<unknown> },
    tenantId: string,
  ) => Promise<{
    companyName: string;
    registrationNo: string;
    tin: string | null;
    registeredAddress: string | null;
  } | null>;
};

const TENANT = 'tn_kyb';

function dbReturning(kybPayload: unknown) {
  return {
    execute: vi.fn(async () => ({ rows: [{ kyb_payload: kybPayload }] })),
  };
}

describe('loadCapturedKyb', () => {
  it('returns the captured KYB facts from the latest run', async () => {
    const db = dbReturning({
      companyName: 'Asha Mining Ltd',
      registrationNo: 'BRELA-12345',
      tin: '123-456-789',
      registeredAddress: 'Geita, TZ',
      directors: [{ fullName: 'Asha', nidaId: 'NIDA-1' }],
    });
    const kyb = await loadCapturedKyb(db, TENANT);
    expect(kyb).not.toBeNull();
    expect(kyb!.companyName).toBe('Asha Mining Ltd');
    expect(kyb!.registrationNo).toBe('BRELA-12345');
    expect(kyb!.tin).toBe('123-456-789');
    expect(kyb!.registeredAddress).toBe('Geita, TZ');
  });

  it('returns null when no run has a kyb step (no fabricated company)', async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    expect(await loadCapturedKyb(db, TENANT)).toBeNull();
  });

  it('returns null when the kyb payload is malformed (missing registrationNo)', async () => {
    const db = dbReturning({ companyName: 'No Reg Co' });
    expect(await loadCapturedKyb(db, TENANT)).toBeNull();
  });

  it('binds the tenant id into the query (tenant-scoped read)', async () => {
    const db = dbReturning({
      companyName: 'Asha Mining Ltd',
      registrationNo: 'BRELA-12345',
    });
    await loadCapturedKyb(db, TENANT);
    const call = db.execute.mock.calls[0]![0] as { queryChunks?: unknown[] };
    const boundParams = (call.queryChunks ?? []).filter(
      (c): c is string => typeof c === 'string',
    );
    expect(boundParams).toContain(TENANT);
  });
});
