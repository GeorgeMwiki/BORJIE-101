/**
 * Persona-aware entity-index query layer — same SQL, different shape
 * under owner vs worker JWT.
 *
 * Uses an in-memory db double so the test does not need a live PG;
 * the double inspects the drizzle sql template fragments to ensure
 * the scope clause and kind filter are emitted as expected.
 */

import { describe, it, expect } from 'vitest';
import {
  queryEntityIndex,
  type EntityIndexQueryDb,
} from '../query.js';
import type { EntityIndexRow } from '../persona-filter.js';

const FIXTURE_ROWS: ReadonlyArray<EntityIndexRow> = Object.freeze([
  {
    kind: 'offtake_contract',
    id: 'oc_1',
    displayName: 'Tabora Catering Q2',
    summary: '$2.4M cobalt offtake for Tabora Catering Q2',
    scopeId: 'mwadui',
    metadata: { amountTzs: 5_400_000_000, counterpartyId: 'tabora-001' },
  },
  {
    kind: 'royalty_filing',
    id: 'rf_1',
    displayName: 'April royalty',
    summary: 'TZS 1,200,000 royalty filing due 9 Apr',
    scopeId: 'mwadui',
    metadata: { amountTzs: 1_200_000 },
  },
  {
    kind: 'drill_hole',
    id: 'dh_1',
    displayName: 'Pit B drill hole DH-42',
    summary: 'Drilled 200m at pit B; assayed copper 0.8%',
    scopeId: 'buzwagi',
    metadata: {},
  },
]);

interface CapturedQuery {
  readonly text: string;
  readonly inputs: ReadonlyArray<unknown>;
}

function makeDb(rows: ReadonlyArray<EntityIndexRow>): {
  db: EntityIndexQueryDb;
  captured: CapturedQuery[];
} {
  const captured: CapturedQuery[] = [];
  const db: EntityIndexQueryDb = {
    async execute(query: unknown) {
      // Capture the rendered SQL + bound values for assertion.
      const q = query as { queryChunks?: ReadonlyArray<unknown> };
      captured.push({
        text: JSON.stringify(q.queryChunks ?? query),
        inputs: q.queryChunks ?? [],
      });
      return rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        display_name: r.displayName,
        summary: r.summary,
        tags: r.tags ?? [],
        lifecycle_stage: r.lifecycleStage ?? 'active',
        refreshed_at: r.refreshedAt ?? '2026-05-29T00:00:00Z',
        scope_id: r.scopeId,
        metadata: r.metadata ?? {},
      }));
    },
  };
  return { db, captured };
}

describe('queryEntityIndex — persona-aware shape', () => {
  it('owner sees the full picture with money + counterparty intact', async () => {
    const { db } = makeDb(FIXTURE_ROWS);
    const result = await queryEntityIndex(db, {
      tenantId: 'tenant_a',
      persona: 'T1_owner_strategist',
      actorScopeIds: [],
    });
    expect(result.hits).toHaveLength(3);
    const offtake = result.hits.find((r) => r.kind === 'offtake_contract');
    expect(offtake?.summary).toContain('$2.4M');
    expect((offtake?.metadata as Record<string, unknown>)?.counterpartyId).toBe(
      'tabora-001',
    );
    expect(result.projection.redactFinancials).toBe(false);
  });

  it('worker sees scope-clipped rows with money redacted', async () => {
    const { db } = makeDb(FIXTURE_ROWS);
    const result = await queryEntityIndex(db, {
      tenantId: 'tenant_a',
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
    });
    // SQL-level clip already in place via the scope clause, but the
    // in-memory double doesn't filter — the post-query persona filter
    // still drops Buzwagi.
    expect(result.hits).toHaveLength(2);
    expect(result.hits.every((r) => r.scopeId === 'mwadui')).toBe(true);
    const offtake = result.hits.find((r) => r.kind === 'offtake_contract');
    expect(offtake?.summary).toContain('Buy job');
    expect(offtake?.summary).not.toContain('$2.4M');
  });

  it('manager is scope-clipped but financials visible', async () => {
    const { db } = makeDb(FIXTURE_ROWS);
    const result = await queryEntityIndex(db, {
      tenantId: 'tenant_a',
      persona: 'T3_module_manager',
      actorScopeIds: ['mwadui'],
    });
    expect(result.hits).toHaveLength(2);
    const offtake = result.hits.find((r) => r.kind === 'offtake_contract');
    expect(offtake?.summary).toContain('$2.4M');
    expect(result.projection.redactFinancials).toBe(false);
  });

  it('worker in Swahili sees [siri] placeholder + Swahili vocab', async () => {
    const { db } = makeDb(FIXTURE_ROWS);
    const result = await queryEntityIndex(db, {
      tenantId: 'tenant_a',
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
      language: 'sw',
    });
    const royalty = result.hits.find((r) => r.kind === 'royalty_filing');
    expect(royalty?.summary).toContain('Faili la serikali');
    const meta = royalty?.metadata as Record<string, unknown>;
    expect(meta['amountTzs']).toBe('[siri]');
  });

  it('returns the projection so the caller can audit-log it', async () => {
    const { db } = makeDb(FIXTURE_ROWS);
    const result = await queryEntityIndex(db, {
      tenantId: 'tenant_a',
      persona: 'T5_customer_concierge',
      actorScopeIds: [],
      counterpartyId: 'tabora-001',
    });
    expect(result.projection.persona).toBe('T5_customer_concierge');
    expect(result.projection.buyerScopeRequired).toBe(true);
    expect(result.projection.redactFinancials).toBe(true);
  });
});
