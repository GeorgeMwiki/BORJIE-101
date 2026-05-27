/**
 * Tests for `boundary-tagger.ts` — Chinese-wall enforcement.
 *
 * Coverage targets (R8 spec):
 *   - cross-tenant numeric cell BLOCKED
 *   - cross-tenant preference (no numeric) ALLOWED
 *   - same-tenant numeric ALLOWED (no wall crossed)
 *   - personal-layer (no source_tenant_id) ALWAYS ALLOWED
 *   - recurring-fact with numeric → BLOCKED (per §3.3)
 *   - k=2 cross-tenant count → BELOW floor
 *   - k=3 cross-tenant count → SAFE to surface
 *   - crossTenantFlag tag set when allowed cells from non-active tenant
 *   - hiddenFromTenants includes every blocked source tenant
 *   - empty currentTenantId returns empty allowed list (refuses decision)
 */

import { describe, it, expect } from 'vitest';
import {
  enforceChineseWall,
  tagBoundary,
  cellContainsNumeric,
  K_ANONYMITY_FLOOR,
  type EnforceChineseWallResult,
} from '../boundary-tagger.js';
import type {
  PersonalMemoryCell,
  PersonLayerResult,
  PersonCellKind,
} from '../person-layer.js';

// ────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────

let nextId = 0;

function makeCell(
  overrides: Partial<PersonalMemoryCell> & {
    cellKind: PersonCellKind;
    sourceTenantId?: string | null;
  },
): PersonalMemoryCell {
  nextId += 1;
  return Object.freeze({
    id: overrides.id ?? `cell-${nextId}`,
    personId: overrides.personId ?? 'person-1',
    cellKind: overrides.cellKind,
    key: overrides.key ?? `key-${nextId}`,
    value: overrides.value ?? { ok: true },
    confidence: overrides.confidence ?? 1,
    sourceTenantId: overrides.sourceTenantId ?? null,
    sourceThreadId: overrides.sourceThreadId ?? null,
    capturedAt: overrides.capturedAt ?? new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? null,
  });
}

function makeLayer(cells: PersonalMemoryCell[]): PersonLayerResult {
  const preferences = cells.filter((c) => c.cellKind === 'preference');
  const context = cells.filter(
    (c) => c.cellKind === 'context' || c.cellKind === 'sentiment',
  );
  const recurringFacts = cells.filter((c) => c.cellKind === 'recurring-fact');
  const calibration = cells.filter((c) => c.cellKind === 'calibration');
  return Object.freeze({
    preferences: Object.freeze(preferences),
    context: Object.freeze(context),
    recurringFacts: Object.freeze(recurringFacts),
    calibration: Object.freeze(calibration),
  });
}

// ────────────────────────────────────────────────────────────────────
// cellContainsNumeric — primitive predicate
// ────────────────────────────────────────────────────────────────────

describe('cellContainsNumeric', () => {
  it('detects raw numbers', () => {
    const cell = makeCell({ cellKind: 'preference', value: { tons: 42 } });
    expect(cellContainsNumeric(cell)).toBe(true);
  });

  it('detects numeric-shaped strings', () => {
    const cell = makeCell({
      cellKind: 'context',
      value: { gradeText: '1.4 g/t' },
    });
    expect(cellContainsNumeric(cell)).toBe(true);
  });

  it('returns false for boolean-only payloads', () => {
    const cell = makeCell({
      cellKind: 'preference',
      value: { wantsCallback: true, polite: false },
    });
    expect(cellContainsNumeric(cell)).toBe(false);
  });

  it('returns false for string-only payloads with no digits', () => {
    const cell = makeCell({
      cellKind: 'preference',
      value: { greeting: 'habari', name: 'Asha' },
    });
    expect(cellContainsNumeric(cell)).toBe(false);
  });

  it('walks nested arrays + objects', () => {
    const cell = makeCell({
      cellKind: 'context',
      value: { nested: { deep: [{ price: '500 TZS' }] } },
    });
    expect(cellContainsNumeric(cell)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// enforceChineseWall — core verdict
// ────────────────────────────────────────────────────────────────────

describe('enforceChineseWall — cross-tenant numeric BLOCKED', () => {
  it('blocks a cross-tenant cell that contains a number', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-B',
        value: { gradeText: '1.4 g/t' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.allowedFacts.length).toBe(0);
    expect(verdict.blockedNumeric.length).toBe(1);
  });

  it('blocks a recurring-fact with numeric payload from another tenant', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { lithiumThreshold: 0.8 },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.blockedNumeric.length).toBe(1);
    expect(verdict.allowedFacts.length).toBe(0);
  });
});

describe('enforceChineseWall — preferences ALWAYS allowed', () => {
  it('allows a cross-tenant preference with no numeric payload', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-B',
        value: { language: 'sw' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.allowedFacts.length).toBe(1);
    expect(verdict.blockedNumeric.length).toBe(0);
  });

  it('allows person-level cells (sourceTenantId === null)', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: null,
        value: { language: 'sw' },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: null,
        value: { mother: 'died-aug-2024' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.allowedFacts.length).toBe(2);
    expect(verdict.blockedNumeric.length).toBe(0);
  });

  it('allows same-tenant numeric cells (no wall crossed)', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-A',
        value: { tonnage: 12.5 },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.allowedFacts.length).toBe(1);
    expect(verdict.blockedNumeric.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// k-anonymity (k ≥ 3)
// ────────────────────────────────────────────────────────────────────

describe('enforceChineseWall — k-anonymity floor', () => {
  it('marks k=2 cross-tenant cells as BELOW the k-floor', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { secret: 'numeric: 7' },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { secret: 'numeric: 8' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.countsSafeToSurface.length).toBe(0);
    expect(verdict.countsBelowKFloor.length).toBe(1);
    expect(verdict.countsBelowKFloor[0]?.count).toBe(2);
  });

  it('marks k=3 cross-tenant counts as SAFE to surface', () => {
    expect(K_ANONYMITY_FLOOR).toBe(3);
    const layer = makeLayer([
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { secret: 'numeric: 1' },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { secret: 'numeric: 2' },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { secret: 'numeric: 3' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.countsSafeToSurface.length).toBe(1);
    expect(verdict.countsSafeToSurface[0]?.count).toBe(3);
    expect(verdict.countsBelowKFloor.length).toBe(0);
  });

  it('groups counts independently per (tenant, kind) bucket', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-B',
        value: { lang: 'sw' },
      }),
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-C',
        value: { lang: 'en' },
      }),
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-C',
        value: { lang: 'fr' },
      }),
    ]);
    const verdict = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(verdict.crossTenantCounts.length).toBe(2);
    const tenantB = verdict.crossTenantCounts.find(
      (c) => c.sourceTenantId === 'tenant-B',
    );
    const tenantC = verdict.crossTenantCounts.find(
      (c) => c.sourceTenantId === 'tenant-C',
    );
    expect(tenantB?.count).toBe(1);
    expect(tenantC?.count).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Refuse-to-decide path
// ────────────────────────────────────────────────────────────────────

describe('enforceChineseWall — empty currentTenantId', () => {
  it('treats every cell as blocked and returns empty allowed list', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: null,
        value: { lang: 'sw' },
      }),
      makeCell({
        cellKind: 'context',
        sourceTenantId: 'tenant-B',
        value: { tonnage: 5 },
      }),
    ]);
    const verdict: EnforceChineseWallResult = enforceChineseWall({
      personLayerData: layer,
      currentTenantId: '',
    });
    expect(verdict.allowedFacts.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// tagBoundary — composer-friendly shape
// ────────────────────────────────────────────────────────────────────

describe('tagBoundary', () => {
  it('sets crossTenantFlag when any allowed fact is from another tenant', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-B',
        value: { lang: 'sw' },
      }),
    ]);
    const tags = tagBoundary({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(tags.crossTenantFlag).toBe(true);
  });

  it('does NOT set crossTenantFlag when only same-tenant cells are allowed', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'preference',
        sourceTenantId: 'tenant-A',
        value: { lang: 'sw' },
      }),
      makeCell({
        cellKind: 'preference',
        sourceTenantId: null,
        value: { lang: 'sw' },
      }),
    ]);
    const tags = tagBoundary({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(tags.crossTenantFlag).toBe(false);
  });

  it('includes every blocked source tenant in hiddenFromTenants (sorted)', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-C',
        value: { tonnes: 4 },
      }),
      makeCell({
        cellKind: 'context',
        sourceTenantId: 'tenant-B',
        value: { profit: 1000 },
      }),
    ]);
    const tags = tagBoundary({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(tags.hiddenFromTenants).toEqual(['tenant-B', 'tenant-C']);
  });

  it('exposes safe counts on the tag bag', () => {
    const layer = makeLayer([
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { tonnes: 1 },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { tonnes: 2 },
      }),
      makeCell({
        cellKind: 'recurring-fact',
        sourceTenantId: 'tenant-B',
        value: { tonnes: 3 },
      }),
    ]);
    const tags = tagBoundary({
      personLayerData: layer,
      currentTenantId: 'tenant-A',
    });
    expect(tags.countsSafeToSurface.length).toBe(1);
    expect(tags.countsSafeToSurface[0]?.count).toBe(3);
  });
});
