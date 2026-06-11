/**
 * Tests for the per-owner NOI materiality-threshold derivation and the
 * `owner.noi_down_10pct` rule wired to it.
 *
 * Covers all three provenance paths (configured / cohort / fallback),
 * the measured-magnitude gate, and the evidence parser.
 */
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_MATERIAL_DROP_PCT,
  MIN_COHORT_SIZE,
  noiDownIsMaterial,
  parseMeasuredDropPct,
  resolveNoiThreshold,
} from '../noi-threshold.js';
import { computeTriggers } from '../engine.js';
import type {
  BehavioralSignals,
  IntentSignal,
  OwnerProfile,
  OwnerPropertyFinancials,
} from '../../types.js';

const fixedNow = new Date('2026-05-24T12:00:00Z');

function emptySignals(intents: IntentSignal[] = []): BehavioralSignals {
  return {
    recentActivity: {
      windowDays: 14,
      loginCount: 0,
      pagesViewed: 0,
      featuresTouched: [],
      searchQueries: [],
    },
    openItems: {
      openMaintenanceCount: 0,
      unpaidInvoiceCount: 0,
      unpaidBalance: 0,
      expiringDocuments: [],
      leaseDecisionsDue: [],
      pendingSignOffs: [],
    },
    lifecycleStage: 'active',
    intentSignals: intents,
  };
}

function prop(
  id: string,
  noiAnnualized?: number,
): OwnerPropertyFinancials {
  const base: OwnerPropertyFinancials = {
    propertyId: id,
    propertyName: id.toUpperCase(),
    currency: 'TZS',
  };
  return noiAnnualized === undefined ? base : { ...base, noiAnnualized };
}

function ownerProfile(partial: Partial<OwnerProfile> = {}): OwnerProfile {
  return {
    identity: { userId: 'u-owner', tenantId: 't1' },
    properties: [],
    ...partial,
  };
}

function noiDownSignal(evidence: string): IntentSignal[] {
  return [{ kind: 'finance.noi_down', confidence: 0.9, evidence }];
}

// --------------------------------------------------------------------------
// resolveNoiThreshold — precedence
// --------------------------------------------------------------------------

describe('resolveNoiThreshold — configured', () => {
  it('uses a valid per-owner configured drop pct over cohort/fallback', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 100), prop('p2', 100), prop('p3', 100)],
      preferences: { noiMaterialDropPct: 7.5 },
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('configured');
    expect(t.dropPct).toBe(7.5);
  });

  it('ignores out-of-range configured values and falls through', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 100)],
      preferences: { noiMaterialDropPct: 0 }, // not > 0
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).not.toBe('configured');
  });

  it('ignores non-numeric configured values', () => {
    const profile = ownerProfile({
      properties: [],
      preferences: { noiMaterialDropPct: 'twelve' as unknown as number },
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('fallback');
  });
});

describe('resolveNoiThreshold — cohort-derived', () => {
  it('derives from the owner own per-property NOI spread when cohort is large enough', () => {
    // Dispersed cohort → derived bar above the floor.
    const profile = ownerProfile({
      properties: [
        prop('p1', 100),
        prop('p2', 300),
        prop('p3', 500),
        prop('p4', 900),
      ],
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('cohort');
    expect(t.cohortSize).toBe(4);
    // Bar is a real number in the clamped band, not the magic fallback.
    expect(t.dropPct).toBeGreaterThan(FALLBACK_MATERIAL_DROP_PCT);
    expect(t.dropPct).toBeLessThanOrEqual(35);
  });

  it('clamps a uniform cohort up to the conservative floor (never below)', () => {
    // Zero dispersion → derived 0, clamped to the documented floor.
    const profile = ownerProfile({
      properties: [prop('p1', 200), prop('p2', 200), prop('p3', 200)],
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('cohort');
    expect(t.dropPct).toBe(FALLBACK_MATERIAL_DROP_PCT);
  });

  it('declines to derive when fewer than MIN_COHORT_SIZE positive NOI points', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 100), prop('p2', 200)], // only 2
    });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('fallback');
    expect(MIN_COHORT_SIZE).toBe(3);
  });
});

describe('resolveNoiThreshold — fallback', () => {
  it('uses the documented conservative default when no config and no cohort', () => {
    const profile = ownerProfile({ properties: [] });
    const t = resolveNoiThreshold(profile);
    expect(t.source).toBe('fallback');
    expect(t.dropPct).toBe(FALLBACK_MATERIAL_DROP_PCT);
    expect(t.cohortSize).toBe(0);
  });

  it('ignores zero/negative NOI values when counting the cohort', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 0), prop('p2', -50), prop('p3', 100)],
    });
    const t = resolveNoiThreshold(profile);
    // Only one positive point → below MIN_COHORT_SIZE → fallback.
    expect(t.source).toBe('fallback');
    expect(t.cohortSize).toBe(1);
  });
});

// --------------------------------------------------------------------------
// parseMeasuredDropPct + noiDownIsMaterial
// --------------------------------------------------------------------------

describe('parseMeasuredDropPct', () => {
  it('extracts a percentage from free-form evidence', () => {
    expect(parseMeasuredDropPct('NOI down 12% MoM')).toBe(12);
    expect(parseMeasuredDropPct('down 8.5 %')).toBe(8.5);
  });
  it('returns undefined when no magnitude is present', () => {
    expect(parseMeasuredDropPct('NOI is trending down')).toBeUndefined();
    expect(parseMeasuredDropPct(undefined)).toBeUndefined();
  });
});

describe('noiDownIsMaterial', () => {
  const threshold = { dropPct: 10, source: 'fallback' as const, cohortSize: 0 };
  it('fires when measured drop meets the bar', () => {
    expect(noiDownIsMaterial({ threshold, measuredDropPct: 12 })).toBe(true);
    expect(noiDownIsMaterial({ threshold, measuredDropPct: 10 })).toBe(true);
  });
  it('does not fire when measured drop is below the bar', () => {
    expect(noiDownIsMaterial({ threshold, measuredDropPct: 4 })).toBe(false);
  });
  it('fires (investigate mode) when magnitude is unknown', () => {
    expect(noiDownIsMaterial({ threshold, measuredDropPct: undefined })).toBe(true);
  });
});

// --------------------------------------------------------------------------
// owner.noi_down_10pct rule — end-to-end through the engine
// --------------------------------------------------------------------------

function fireOwner(profile: OwnerProfile, intents: IntentSignal[]): ReadonlyArray<string> {
  return computeTriggers({
    profile,
    signals: emptySignals(intents),
    role: 'owner',
    userId: profile.identity.userId,
    tenantId: profile.identity.tenantId,
    now: fixedNow,
  }).map((t) => t.kind);
}

describe('owner.noi_down_10pct rule', () => {
  it('fires when the measured drop clears the configured bar', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 1000)],
      totalPortfolioNoi: 1000,
      preferences: { noiMaterialDropPct: 5 },
    });
    expect(fireOwner(profile, noiDownSignal('down 6%'))).toContain('owner.noi_down_10pct');
  });

  it('does NOT fire when the measured drop is below the bar', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 1000)],
      totalPortfolioNoi: 1000,
      preferences: { noiMaterialDropPct: 15 },
    });
    expect(fireOwner(profile, noiDownSignal('down 6%'))).not.toContain('owner.noi_down_10pct');
  });

  it('fires when the downturn signal carries no magnitude (investigate mode)', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 1000)],
      totalPortfolioNoi: 1000,
    });
    expect(fireOwner(profile, noiDownSignal('NOI trending down'))).toContain('owner.noi_down_10pct');
  });

  it('does NOT fire without the upstream downturn signal', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 1000)],
      totalPortfolioNoi: 1000,
    });
    expect(fireOwner(profile, [])).not.toContain('owner.noi_down_10pct');
  });

  it('summary reflects the threshold provenance (cohort)', () => {
    const profile = ownerProfile({
      properties: [prop('p1', 100), prop('p2', 300), prop('p3', 500), prop('p4', 900)],
      totalPortfolioNoi: 1800,
    });
    const triggers = computeTriggers({
      profile,
      signals: emptySignals(noiDownSignal('down 40%')),
      role: 'owner',
      userId: profile.identity.userId,
      tenantId: profile.identity.tenantId,
      now: fixedNow,
    });
    const noi = triggers.find((t) => t.kind === 'owner.noi_down_10pct');
    expect(noi?.summary).toContain("derived from your portfolio's own NOI spread");
  });
});
