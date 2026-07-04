/**
 * isKillswitchHalted — fail-closed platform/tenant HALT reader.
 *
 * Regression oracle for the money-out fail-open (A9/A10): the payouts
 * worker previously read a never-assigned `serviceRegistry.killSwitch`
 * slot (always false → fail-OPEN) so a platform HALT let real owner
 * disbursements keep flowing. These tests pin the canonical reader that
 * now gates the money-out path: `halt` on platform OR tenant scope
 * engages, and any indeterminate state (no db / query error) fails CLOSED.
 */
import { describe, it, expect } from 'vitest';
import { isKillswitchHalted } from '../killswitch-rbac.js';

type Row = { readonly scope: string; readonly level: string };

/** Minimal drizzle-shaped fake: .select().from().where() → Promise<rows>. */
const dbReturning = (rows: ReadonlyArray<Row>) => ({
  select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
});
const dbThrowing = () => ({
  select: () => ({
    from: () => ({ where: () => Promise.reject(new Error('db down')) }),
  }),
});

describe('isKillswitchHalted (fail-closed money-out gate)', () => {
  it('fails CLOSED when there is no db handle', async () => {
    expect(await isKillswitchHalted(null)).toBe(true);
    expect(await isKillswitchHalted(undefined)).toBe(true);
  });

  it('fails CLOSED when the query throws', async () => {
    expect(await isKillswitchHalted(dbThrowing(), { tenantId: 't1' })).toBe(
      true,
    );
  });

  it('engages when the PLATFORM scope is at level halt', async () => {
    const db = dbReturning([{ scope: 'platform', level: 'halt' }]);
    expect(await isKillswitchHalted(db)).toBe(true);
  });

  it('engages when the TENANT scope is at level halt', async () => {
    const db = dbReturning([{ scope: 'tenant:t1', level: 'halt' }]);
    expect(await isKillswitchHalted(db, { tenantId: 't1' })).toBe(true);
  });

  it('does NOT engage when the switch is live or absent', async () => {
    expect(await isKillswitchHalted(dbReturning([]))).toBe(false);
    expect(
      await isKillswitchHalted(dbReturning([{ scope: 'platform', level: 'live' }])),
    ).toBe(false);
  });

  it('does NOT engage on a soft degraded signal (only halt stops money)', async () => {
    const db = dbReturning([{ scope: 'platform', level: 'degraded' }]);
    expect(await isKillswitchHalted(db)).toBe(false);
  });
});
