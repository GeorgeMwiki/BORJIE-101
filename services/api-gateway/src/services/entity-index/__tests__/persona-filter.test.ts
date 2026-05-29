/**
 * persona-filter tests — same query, different shape.
 *
 * Covers:
 *  - owner sees full picture (no redaction, no scope clip)
 *  - manager is scope-clipped to their owned sites
 *  - worker is scope-clipped + financials redacted + worker vocab
 *  - buyer is buyer-scope-required + financials redacted
 *  - auditor sees everything unmodified
 *  - bilingual sw redaction uses Swahili placeholder
 *  - metadata money fields are scrubbed for workers
 */

import { describe, it, expect } from 'vitest';
import {
  applyPersonaFilter,
  computePersonaProjection,
  type EntityIndexRow,
} from '../persona-filter.js';

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

describe('computePersonaProjection', () => {
  it('owner / admin / auditor get full picture', () => {
    for (const persona of ['T1_owner_strategist', 'T2_admin_strategist', 'T_auditor'] as const) {
      const proj = computePersonaProjection({ persona, actorScopeIds: [] });
      expect(proj.scopeIdsAllowed).toBeNull();
      expect(proj.redactFinancials).toBe(false);
      expect(proj.rewriteWorkerVocab).toBe(false);
    }
  });

  it('manager is scope-clipped but financials visible', () => {
    const proj = computePersonaProjection({
      persona: 'T3_module_manager',
      actorScopeIds: ['mwadui'],
    });
    expect(proj.scopeIdsAllowed).toEqual(['mwadui']);
    expect(proj.redactFinancials).toBe(false);
    expect(proj.rewriteWorkerVocab).toBe(false);
  });

  it('worker is scope-clipped + financials redacted + worker vocab', () => {
    const proj = computePersonaProjection({
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
    });
    expect(proj.scopeIdsAllowed).toEqual(['mwadui']);
    expect(proj.redactFinancials).toBe(true);
    expect(proj.rewriteWorkerVocab).toBe(true);
  });

  it('buyer requires counterparty scope binding', () => {
    const proj = computePersonaProjection({
      persona: 'T5_customer_concierge',
      actorScopeIds: [],
      counterpartyId: 'tabora-001',
    });
    expect(proj.redactFinancials).toBe(true);
    expect(proj.buyerScopeRequired).toBe(true);
  });
});

describe('applyPersonaFilter', () => {
  it('owner sees all 3 rows with original summary + metadata', () => {
    const owner = computePersonaProjection({
      persona: 'T1_owner_strategist',
      actorScopeIds: [],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, owner);
    expect(out).toHaveLength(3);
    expect(out[0]?.summary).toContain('$2.4M');
    expect((out[0]?.metadata as Record<string, unknown>)?.amountTzs).toBe(5_400_000_000);
  });

  it('manager sees only their Mwadui rows (Buzwagi clipped)', () => {
    const mgr = computePersonaProjection({
      persona: 'T3_module_manager',
      actorScopeIds: ['mwadui'],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, mgr);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.scopeId === 'mwadui')).toBe(true);
    // Financials still visible to manager.
    expect(out[0]?.summary).toContain('$2.4M');
  });

  it('worker sees scope-clipped rows with money redacted + worker vocab', () => {
    const worker = computePersonaProjection({
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, worker, 'en');
    expect(out).toHaveLength(2);
    // offtake_contract gets worker vocab swap.
    const offtake = out.find((r) => r.kind === 'offtake_contract');
    expect(offtake?.summary).toContain('Buy job');
    expect(offtake?.summary).not.toContain('$2.4M');
    expect(offtake?.summary).toContain('[redacted]');
    // Metadata money fields scrubbed.
    const meta = offtake?.metadata as Record<string, unknown>;
    expect(meta['amountTzs']).toBe('[redacted]');
    expect(meta['counterpartyId']).toBe('[redacted]');
  });

  it('worker in Swahili sees [siri] placeholder', () => {
    const worker = computePersonaProjection({
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, worker, 'sw');
    const royalty = out.find((r) => r.kind === 'royalty_filing');
    // Swahili vocab + Swahili redaction placeholder.
    expect(royalty?.summary).toContain('Faili la serikali');
    const meta = royalty?.metadata as Record<string, unknown>;
    expect(meta['amountTzs']).toBe('[siri]');
  });

  it('returns frozen rows (immutability)', () => {
    const worker = computePersonaProjection({
      persona: 'T4_field_employee',
      actorScopeIds: ['mwadui'],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, worker);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out[0])).toBe(true);
  });

  it('owner / auditor path is a no-op (returns the same array reference)', () => {
    const owner = computePersonaProjection({
      persona: 'T1_owner_strategist',
      actorScopeIds: [],
    });
    const out = applyPersonaFilter(FIXTURE_ROWS, owner);
    expect(out).toBe(FIXTURE_ROWS);
  });
});
