/**
 * Promotion-decider tests (Wave 18AA).
 *
 * Pure-function tests — no IO, no time mocking beyond passing an
 * explicit `now_iso` argument.
 */

import { describe, expect, it } from 'vitest';
import {
  isContradictionPlausible,
  nextPromotion,
  shouldDecay,
  shouldPromoteToConsolidated,
  shouldPromoteToReinforced,
} from '../promotion/promotion-decider.js';
import {
  CONSOLIDATE_ELAPSED_DAYS,
  CONSOLIDATE_RECALL_THRESHOLD,
  DECAY_IDLE_DAYS,
  type CognitiveMemoryCell,
} from '../types.js';

function baseCell(overrides: Partial<CognitiveMemoryCell> = {}): CognitiveMemoryCell {
  return {
    id: 'c1',
    tenant_id: 't1',
    scope_id: 'tenant_root',
    content: { text: 'x', embedding: [], structured: {} },
    kind: 'fact',
    contributed_by_specialisation: 'geology',
    reinforced_by_specialisations: [],
    contributed_in_turn_id: 'turn-1',
    reinforced_in_turn_ids: [],
    evidence_citations: [],
    confidence_score: 0.5,
    access_count: 0,
    last_accessed_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    promoted_at: null,
    decayed_at: null,
    promotion_status: 'observed',
    contradicting_cell_id: null,
    audit_hash: 'h',
    ...overrides,
  };
}

describe('shouldPromoteToReinforced', () => {
  it('requires ≥2 distinct OTHER specialisations', () => {
    expect(shouldPromoteToReinforced(baseCell()).action).toBe('none');
    expect(
      shouldPromoteToReinforced(
        baseCell({ reinforced_by_specialisations: ['marketplace'] }),
      ).action,
    ).toBe('none');
    expect(
      shouldPromoteToReinforced(
        baseCell({
          reinforced_by_specialisations: ['marketplace', 'finance'],
        }),
      ).action,
    ).toBe('promote');
  });

  it('does NOT count the contributor as a distinct reinforcer', () => {
    expect(
      shouldPromoteToReinforced(
        baseCell({ reinforced_by_specialisations: ['geology', 'marketplace'] }),
      ).action,
    ).toBe('none');
  });

  it('does not double-fire once already reinforced', () => {
    expect(
      shouldPromoteToReinforced(
        baseCell({
          promotion_status: 'reinforced',
          reinforced_by_specialisations: ['a', 'b', 'c'],
        }),
      ).action,
    ).toBe('none');
  });
});

describe('shouldPromoteToConsolidated', () => {
  it('requires ≥10 recalls + ≥14 days + no contradictions', () => {
    const tooFew = baseCell({
      promotion_status: 'reinforced',
      access_count: 4,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(shouldPromoteToConsolidated(tooFew, '2026-05-26T00:00:00.000Z').action).toBe(
      'none',
    );
    const tooRecent = baseCell({
      promotion_status: 'reinforced',
      access_count: CONSOLIDATE_RECALL_THRESHOLD,
      created_at: '2026-05-26T00:00:00.000Z',
    });
    expect(shouldPromoteToConsolidated(tooRecent, '2026-05-30T00:00:00.000Z').action).toBe(
      'none',
    );
    const eligible = baseCell({
      promotion_status: 'reinforced',
      access_count: CONSOLIDATE_RECALL_THRESHOLD,
      created_at: '2026-05-01T00:00:00.000Z',
    });
    const after = new Date(
      Date.parse(eligible.created_at) + (CONSOLIDATE_ELAPSED_DAYS + 1) * 86_400_000,
    ).toISOString();
    const decision = shouldPromoteToConsolidated(eligible, after);
    expect(decision.action).toBe('promote');
    if (decision.action === 'promote') {
      expect(decision.to).toBe('consolidated');
    }
  });

  it('blocks promotion when contradicted', () => {
    const c = baseCell({
      promotion_status: 'reinforced',
      access_count: 50,
      created_at: '2025-01-01T00:00:00.000Z',
      contradicting_cell_id: 'c2',
    });
    expect(shouldPromoteToConsolidated(c, '2026-05-26T00:00:00.000Z').action).toBe('none');
  });
});

describe('shouldDecay', () => {
  it('fires after 180 days idle', () => {
    const idle = baseCell({
      promotion_status: 'consolidated',
      last_accessed_at: '2025-11-01T00:00:00.000Z',
    });
    expect(shouldDecay(idle, '2026-05-26T00:00:00.000Z').action).toBe('promote');
    const active = baseCell({
      promotion_status: 'consolidated',
      last_accessed_at: '2026-05-01T00:00:00.000Z',
    });
    expect(shouldDecay(active, '2026-05-26T00:00:00.000Z').action).toBe('none');
    void DECAY_IDLE_DAYS;
  });
});

describe('isContradictionPlausible', () => {
  it('rejects below 0.7', () => {
    expect(isContradictionPlausible(0.69)).toBe(false);
    expect(isContradictionPlausible(0.7)).toBe(true);
    expect(isContradictionPlausible(1)).toBe(true);
  });
});

describe('nextPromotion', () => {
  it('routes by current status', () => {
    const obs = baseCell({
      reinforced_by_specialisations: ['a', 'b'],
    });
    const dec = nextPromotion(obs, '2026-05-26T00:00:00.000Z');
    expect(dec.action).toBe('promote');
  });
});
