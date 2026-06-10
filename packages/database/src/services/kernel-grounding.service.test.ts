/**
 * Unit tests for createKernelGroundingProvider — the always-on situational
 * grounding the central-intelligence kernel injects into its system prompt.
 *
 * The DatabaseClient is stubbed so we can:
 *   1. assert the estate-wide facts (royalty / treasury / workforce /
 *      compliance / marketplace / holdings / assets) appear when their
 *      backing tables have rows;
 *   2. assert a single failing query (e.g. a missing table) degrades to
 *      absent and NEVER throws out of fetch (honest-degrade);
 *   3. assert the visibility contract (sovereign / no-tenant -> empty);
 *   4. assert relevance ordering floats a message-relevant estate fact
 *      above the production core so it survives the per-turn cap.
 */
import { describe, it, expect } from 'vitest';
import { createKernelGroundingProvider } from './kernel-grounding.service.js';
import type { DatabaseClient } from '../client.js';
import { licences } from '../schemas/licences.schema.js';
import { sales } from '../schemas/production-sales.schema.js';
import { productionTonnageEvents } from '../schemas/production-tonnage.schema.js';
import { incidents } from '../schemas/safety-csr.schema.js';
import { settlements } from '../schemas/settlements.schema.js';
import { accounts } from '../schemas/payments-ledger.schema.js';
import { employees } from '../schemas/workforce.schema.js';
import { regulatoryFilings } from '../schemas/regulatory-filings.schema.js';
import { marketplaceBids } from '../schemas/marketplace-bids.schema.js';
import { estateEntities } from '../schemas/estate-entities.schema.js';
import { estateAssets } from '../schemas/estate-assets.schema.js';

type AnyTable = object;

/**
 * Build a stub DatabaseClient whose `select().from(table).where()` resolves
 * to the row(s) registered for that table, or throws the registered error
 * (to simulate a missing table) so we can assert per-fact honest-degrade.
 */
function makeStubDb(
  rowsByTable: ReadonlyMap<AnyTable, ReadonlyArray<Record<string, unknown>>>,
  throwForTable?: AnyTable,
): DatabaseClient {
  return {
    select: () => ({
      from: (table: AnyTable) => ({
        where: () => {
          if (throwForTable && table === throwForTable) {
            return Promise.reject(new Error('relation does not exist'));
          }
          return Promise.resolve(rowsByTable.get(table) ?? []);
        },
      }),
    }),
  } as unknown as DatabaseClient;
}

/** All 13 tables wired with one non-empty row each. */
function fullRows(): Map<AnyTable, ReadonlyArray<Record<string, unknown>>> {
  return new Map<AnyTable, ReadonlyArray<Record<string, unknown>>>([
    [licences, [{ n: 4 }]],
    [sales, [{ tzs: '9000' }]],
    [productionTonnageEvents, [{ tonnes: '120' }]],
    [incidents, [{ n: 2 }]],
    [settlements, [{ tzs: '700000' }]],
    [accounts, [{ tzs: '5000000' }]],
    [employees, [{ n: 37 }]],
    [regulatoryFilings, [{ n: 5 }]],
    [marketplaceBids, [{ n: 8 }]],
    [estateEntities, [{ n: 3 }]],
    [estateAssets, [{ n: 64 }]],
  ]);
}

const deps = { tenantId: 'tenant-1', role: 'owner' as const };

describe('createKernelGroundingProvider — estate-wide facts', () => {
  it('emits the relevant estate fact when its table has rows', async () => {
    const provider = createKernelGroundingProvider(makeStubDb(fullRows()), deps);
    const facts = await provider.fetch({
      userMessage: 'what is my outstanding royalty balance?',
      tier: 'tenant',
      limit: 6,
    });
    const royalty = facts.find((f) => f.id === 'grounding-outstanding-royalty');
    expect(royalty).toBeDefined();
    expect(royalty?.value).toBe(700000);
    expect(royalty?.unit).toBe('currency-tzs');
    expect(royalty?.source).toBe('settlements');
  });

  it('surfaces treasury / workforce / asset facts for matching messages', async () => {
    const db = makeStubDb(fullRows());
    const treasury = await createKernelGroundingProvider(db, deps).fetch({
      userMessage: 'how much cash is in the treasury wallet?',
      tier: 'tenant',
      limit: 6,
    });
    expect(
      treasury.find((f) => f.id === 'grounding-treasury-balance')?.value,
    ).toBe(5000000);

    const workforce = await createKernelGroundingProvider(db, deps).fetch({
      userMessage: 'what is my current workforce headcount?',
      tier: 'tenant',
      limit: 6,
    });
    expect(
      workforce.find((f) => f.id === 'grounding-workforce-headcount')?.value,
    ).toBe(37);

    const assets = await createKernelGroundingProvider(db, deps).fetch({
      userMessage: 'how many items are on the asset register?',
      tier: 'tenant',
      limit: 6,
    });
    expect(
      assets.find((f) => f.id === 'grounding-asset-register')?.value,
    ).toBe(64);
  });

  it('omits exactly the failing fact and never throws (honest-degrade)', async () => {
    // settlements query rejects (simulating a missing/renamed table).
    const db = makeStubDb(fullRows(), settlements);
    const facts = await createKernelGroundingProvider(db, deps).fetch({
      userMessage: 'royalty and workforce and treasury status',
      tier: 'tenant',
      limit: 6,
    });
    expect(
      facts.some((f) => f.id === 'grounding-outstanding-royalty'),
    ).toBe(false);
    // Other facts still resolve — degradation is per-fact, not all-or-nothing.
    expect(facts.some((f) => f.id === 'grounding-treasury-balance')).toBe(true);
  });

  it('treats zero-row tables as an honest zero, not an omission', async () => {
    const empty = new Map<AnyTable, ReadonlyArray<Record<string, unknown>>>([
      [settlements, []],
    ]);
    const facts = await createKernelGroundingProvider(
      makeStubDb(empty),
      deps,
    ).fetch({
      userMessage: 'royalty balance please',
      tier: 'tenant',
      limit: 6,
    });
    const royalty = facts.find((f) => f.id === 'grounding-outstanding-royalty');
    expect(royalty).toBeDefined();
    expect(royalty?.value).toBe(0);
  });

  it('floats a message-relevant fact above the production core within the cap', async () => {
    // The 7 estate-wide facts sit AFTER the original 6; with a cap of 6 a
    // holdings question must still reach the holdings fact via relevance.
    const facts = await createKernelGroundingProvider(
      makeStubDb(fullRows()),
      deps,
    ).fetch({
      userMessage: 'list my holding companies and subsidiaries',
      tier: 'tenant',
      limit: 6,
    });
    expect(facts.length).toBeLessThanOrEqual(6);
    expect(facts.some((f) => f.id === 'grounding-holding-companies')).toBe(true);
  });

  it('returns empty for sovereign role and for no-tenant scope', async () => {
    const db = makeStubDb(fullRows());
    const sovereign = await createKernelGroundingProvider(db, {
      tenantId: 'tenant-1',
      role: 'sovereign',
    }).fetch({ userMessage: 'royalty', tier: 'sovereign', limit: 6 });
    expect(sovereign).toEqual([]);

    const platform = await createKernelGroundingProvider(db, {
      tenantId: null,
    }).fetch({ userMessage: 'royalty', tier: 'tenant', limit: 6 });
    expect(platform).toEqual([]);
  });
});
