/**
 * Scanner brain-tools — DEGRADED self-report reaches the LIVE tool payload.
 *
 * The dark-consumer this pins: the `mining.risks.scan` /
 * `mining.opportunities.scan` brain-tool handlers used to call the plain
 * `scanRisks` / `resolveScanState`, dropping the degraded-read collector, and
 * `ScanOutput` had no field to carry the signal. A missing backing relation
 * (undefined-table 42P01 — a deploy/wiring drift, e.g. the 0370-excluded
 * `lbma_fix_summary` / `fx_rates_intraday`) therefore silently all-cleared on
 * the real surface: an empty `risks` / `opportunities` list with NO indication
 * the data could not even be read.
 *
 * After the fix the handlers route through the `*Report` variants and the tool
 * payload carries `unavailable: true` + `degradedRelations` naming the relation,
 * so the persona/SSE renders an explicit "some data could not be read" note.
 *
 * RED before (no `unavailable` field on the payload), GREEN after.
 */

import { describe, expect, it } from 'vitest';

import {
  configureRiskScannerTools,
  riskScanTool,
} from '../risk-scanner-tools';
import {
  configureOpportunityScannerTools,
  opportunityScanTool,
} from '../opportunity-scanner-tools';

const tenantId = 'tenant-scanner-degraded-1';
const now = () => new Date('2026-07-02T00:00:00.000Z');

class PgError extends Error {
  code: string;
  table?: string;
  constructor(code: string, message: string, table?: string) {
    super(message);
    this.code = code;
    if (table !== undefined) this.table = table;
  }
}

/** A bare `{ execute }` stub — no `.transaction`, so withTenantContext runs
 * the resolver callback directly. Every read throws an undefined_table error
 * for one named relation. */
function missingTableDb(relation: string): { execute: () => Promise<unknown> } {
  return {
    execute: async () => {
      throw new PgError(
        '42P01',
        `relation "${relation}" does not exist`,
        relation,
      );
    },
  };
}

/** A `{ execute }` stub that returns a genuine empty result set (no error). */
function emptyDb(): { execute: () => Promise<unknown> } {
  return { execute: async () => ({ rows: [] }) };
}

const ctx = {
  tenantId,
  actorId: 'user-1',
  personaSlug: 'T1_owner_strategist',
} as const;

describe('risk-scanner brain tool — degraded self-report reaches the payload', () => {
  it('carries unavailable:true + the relation name when a backing table is missing', async () => {
    configureRiskScannerTools({
      db: missingTableDb('accounts_receivable') as never,
      now,
    });
    const out = await riskScanTool.handler(
      { maxResults: 5, minSeverity: 'medium' },
      ctx,
    );
    // The scan could NOT read its backing data — the tool self-reports.
    expect(out.unavailable).toBe(true);
    expect(out.degradedRelations).toContain('accounts_receivable');
    // No risks fabricated from unreadable state.
    expect(out.risks.length).toBe(0);
  });

  it('keeps a genuine no-rows result as an honest all-clear (unavailable:false)', async () => {
    configureRiskScannerTools({ db: emptyDb() as never, now });
    const out = await riskScanTool.handler(
      { maxResults: 5, minSeverity: 'medium' },
      ctx,
    );
    expect(out.unavailable).toBe(false);
    expect(out.degradedRelations).toEqual([]);
  });
});

describe('opportunity-scanner brain tool — degraded self-report reaches the payload', () => {
  it('carries unavailable:true + the relation name when a backing table is missing', async () => {
    configureOpportunityScannerTools({
      db: missingTableDb('fx_rates_intraday') as never,
    });
    const out = await opportunityScanTool.handler({ maxResults: 3 }, ctx);
    expect(out.unavailable).toBe(true);
    expect(out.degradedRelations).toContain('fx_rates_intraday');
    expect(out.opportunities.length).toBe(0);
  });

  it('keeps a genuine no-rows result as an honest all-clear (unavailable:false)', async () => {
    configureOpportunityScannerTools({ db: emptyDb() as never });
    const out = await opportunityScanTool.handler({ maxResults: 3 }, ctx);
    expect(out.unavailable).toBe(false);
    expect(out.degradedRelations).toEqual([]);
  });
});
