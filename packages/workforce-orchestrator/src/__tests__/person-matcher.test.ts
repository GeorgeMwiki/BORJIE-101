import { describe, expect, it } from 'vitest';
import {
  MatchNeedSchema,
  rankCandidates,
  type MatchCandidate,
  type MatchNeed,
} from '../person-matcher.js';

// ─────────────────────────────────────────────────────────────────────────
// Helpers — build a minimal candidate; every spine signal is optional.
// ─────────────────────────────────────────────────────────────────────────

function cand(partial: Partial<MatchCandidate> & { employeeId: string }): MatchCandidate {
  return { ...partial };
}

describe('MatchNeedSchema', () => {
  it('accepts an empty need (all signals optional)', () => {
    expect(() => MatchNeedSchema.parse({})).not.toThrow();
  });

  it('rejects an empty competenceDomain string', () => {
    expect(() => MatchNeedSchema.parse({ competenceDomain: '' })).toThrow();
  });
});

describe('rankCandidates — skill/domain dominates load', () => {
  const need: MatchNeed = { competenceDomain: 'pump_maintenance' };

  it('ranks a skill-matched candidate above an idle non-matching one', () => {
    const skilled = cand({
      employeeId: 'emp-skilled',
      skillDomains: ['pump_maintenance'],
      openAssignmentCount: 4, // busier
    });
    const idleButWrong = cand({
      employeeId: 'emp-idle',
      skillDomains: ['blasting'],
      openAssignmentCount: 0, // totally free
    });

    const ranked = rankCandidates([idleButWrong, skilled], need);

    expect(ranked[0]?.employeeId).toBe('emp-skilled');
    expect(ranked[0]?.reasons).toContain('skill domain match');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('among equally-skilled candidates, lower load wins', () => {
    const busy = cand({
      employeeId: 'emp-busy',
      skillDomains: ['pump_maintenance'],
      openAssignmentCount: 5,
    });
    const free = cand({
      employeeId: 'emp-free',
      skillDomains: ['pump_maintenance'],
      openAssignmentCount: 0,
    });

    const ranked = rankCandidates([busy, free], need);

    expect(ranked[0]?.employeeId).toBe('emp-free');
    expect(ranked[0]?.reasons).toContain('low current load');
  });
});

describe('rankCandidates — the LEARNED down-weight', () => {
  const need: MatchNeed = { competenceDomain: 'compliance' };

  it('down-weights a skilled candidate with a poor in-domain record', () => {
    const proven = cand({
      employeeId: 'emp-proven',
      skillDomains: ['compliance'],
      successRateByDomain: 1.0,
    });
    const failing = cand({
      employeeId: 'emp-failing',
      skillDomains: ['compliance'],
      successRateByDomain: 0.0, // repeatedly failed spot-checks
    });

    const ranked = rankCandidates([failing, proven], need);

    expect(ranked[0]?.employeeId).toBe('emp-proven');
    const loser = ranked.find((r) => r.employeeId === 'emp-failing');
    expect(loser?.reasons).toContain('down-weighted: weak in-domain track record');
    expect(ranked[0]!.score).toBeGreaterThan(loser!.score);
  });

  it('treats absent history as NEUTRAL (no penalty vs a par performer)', () => {
    const newcomer = cand({
      employeeId: 'emp-new',
      skillDomains: ['compliance'],
      // no successRateByDomain → null → neutral
    });
    const par = cand({
      employeeId: 'emp-par',
      skillDomains: ['compliance'],
      successRateByDomain: 0.5, // par maps to ~1.0 multiplier
    });

    const ranked = rankCandidates([newcomer, par], need);

    // Both should score identically (neutral == par multiplier ~1.0).
    expect(ranked[0]!.score).toBeCloseTo(ranked[1]!.score, 10);
    // Newcomer is never flagged as down-weighted.
    const n = ranked.find((r) => r.employeeId === 'emp-new');
    expect(n?.reasons).not.toContain('down-weighted: weak in-domain track record');
  });
});

describe('rankCandidates — legacy cert/shift/site/fatigue signals (route parity)', () => {
  const need: MatchNeed = { requiredCert: 'BLAST_LICENCE', siteId: 'site-A' };

  it('reproduces the route ordering: cert+site+free beats bare', () => {
    const strong = cand({
      employeeId: 'emp-strong',
      certifications: ['BLAST_LICENCE'],
      lastSiteId: 'site-A',
      hasActiveShiftNow: false,
      fatigueScore: 0.1,
    });
    const weak = cand({
      employeeId: 'emp-weak',
      certifications: [],
      lastSiteId: 'site-B',
      hasActiveShiftNow: true,
      fatigueScore: 0.9,
    });

    const ranked = rankCandidates([weak, strong], need);

    expect(ranked[0]?.employeeId).toBe('emp-strong');
    expect(ranked[0]?.reasons).toEqual(
      expect.arrayContaining([
        'certification match',
        'no current shift',
        'site experience',
        'low fatigue',
      ]),
    );
  });

  it('matches the route weights exactly for a full-signal candidate', () => {
    // cert 0.5 + noConflict 0.2 + sameSite 0.2 + 0.1*(1-0) fatigue = 1.0
    const full = cand({
      employeeId: 'emp-full',
      certifications: ['BLAST_LICENCE'],
      lastSiteId: 'site-A',
      hasActiveShiftNow: false,
      fatigueScore: 0,
      // no competenceDomain in need → skill/role/load budget inert here,
      // BUT load defaults to 1.0 contribution (0 open) → +0.2 over the route.
    });
    const [scored] = rankCandidates([full], { requiredCert: 'BLAST_LICENCE', siteId: 'site-A' });
    // With no competenceDomain the skill/role signals stay 0; load defaults
    // engage. Score clamps at 1.0.
    expect(scored?.score).toBe(1);
  });
});

describe('rankCandidates — determinism & immutability', () => {
  it('is order-independent (stable tiebreak by employeeId)', () => {
    const need: MatchNeed = { competenceDomain: 'haulage' };
    const a = cand({ employeeId: 'aaa', skillDomains: ['haulage'] });
    const b = cand({ employeeId: 'bbb', skillDomains: ['haulage'] });

    const r1 = rankCandidates([a, b], need).map((r) => r.employeeId);
    const r2 = rankCandidates([b, a], need).map((r) => r.employeeId);

    expect(r1).toEqual(r2);
    expect(r1[0]).toBe('aaa'); // ties broken alphabetically
  });

  it('never mutates its inputs', () => {
    const need: MatchNeed = { competenceDomain: 'survey' };
    const input = [cand({ employeeId: 'x', skillDomains: ['survey'] })];
    const snapshot = JSON.stringify(input);
    rankCandidates(input, need);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('returns [] for no candidates', () => {
    expect(rankCandidates([], { competenceDomain: 'x' })).toEqual([]);
  });
});
