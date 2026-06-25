/**
 * GATE — property-skill retirement (D24 domain purity).
 *
 * Borjie is a MINING estate OS. No property-domain AI skill may survive in the
 * live brain toolset: the model reads a tool's name + description and can select
 * it, so a property tool (service-charge ledgers, sinking funds, per-unit
 * apportionment, Mpangaji, rent/lease/unit) would let the brain echo off-mandate
 * output to a mining owner.
 *
 * Round 8 retired the property skills but `skill.kenya.service_charge_reconcile`
 * survived in KENYA_SKILL_TOOLS and stayed registered into the live brain — the
 * regression slipped because nothing enforced the FULL emission surface. This
 * gate covers that surface end to end:
 *
 *   1. No REGISTERED brain tool (the exact set the LLM can select) carries
 *      property residue in its name or description.
 *   2. Every eval scenario's `expectToolCalls` points at a tool that is actually
 *      registered — a scenario referencing a retired/nonexistent tool is a
 *      dangling reference that LLM-free runs never surface.
 *
 * The residue lexicon is a CLOSED allowlist that can only shrink. Adding a new
 * forbidden term tightens the gate; removing the gate or a term must be a
 * deliberate, reviewed act.
 */

import { describe, it, expect } from 'vitest';
import { createBrainForTesting, ALL_SCENARIOS } from '../index.js';

/**
 * Property-domain residue: terms that mark a tool as serving the property /
 * landlord-tenant domain rather than the mining-estate mandate. Each term has
 * NO legitimate mining-estate meaning, so a hit is unambiguous residue.
 *
 * Deliberately EXCLUDES broad words that carry legitimate mining senses —
 * "lease"/"leasing" (mineral leasing, autonomy-policy leasing), "levy" (the
 * mining-cooperative levy), "per unit" (offtake price basis) — to keep the gate
 * a true-positive ratchet rather than a noisy one.
 */
const PROPERTY_RESIDUE_PATTERNS: ReadonlyArray<RegExp> = [
  /service[_\s-]charge/i,
  /sinking[_\s-]fund/i,
  /per[_\s-]unit\s+apportionment/i,
  /\bmpangaji\b/i,
];

function residueHit(text: string): string | null {
  for (const re of PROPERTY_RESIDUE_PATTERNS) {
    if (re.test(text)) return re.source;
  }
  return null;
}

describe('GATE: property-skill retirement (domain purity)', () => {
  const brain = createBrainForTesting();
  const registered = brain.tools.list();

  it('registers no brain tool carrying property residue in its name', () => {
    const offenders = registered
      .map((t) => ({ name: t.name, hit: residueHit(t.name) }))
      .filter((o) => o.hit !== null);
    expect(
      offenders,
      `property-residue tool name(s) registered into the live brain toolset: ${JSON.stringify(offenders)}`
    ).toEqual([]);
  });

  it('registers no brain tool carrying property residue in its description', () => {
    const offenders = registered
      .map((t) => ({ name: t.name, hit: residueHit(t.description ?? '') }))
      .filter((o) => o.hit !== null);
    expect(
      offenders,
      `property-residue tool description(s) registered into the live brain toolset: ${JSON.stringify(offenders)}`
    ).toEqual([]);
  });

  it('has explicitly retired skill.kenya.service_charge_reconcile', () => {
    expect(brain.tools.has('skill.kenya.service_charge_reconcile')).toBe(false);
  });

  it('keeps the legitimate kenya finance siblings registered', () => {
    expect(brain.tools.has('skill.kenya.mpesa_reconcile')).toBe(true);
    expect(brain.tools.has('skill.kenya.tra_royalty_summary')).toBe(true);
  });

  it('references no property-residue tool from any eval scenario', () => {
    // Eval scenarios are the silent surface: LLM-free runs never exercise
    // `expectToolCalls`, so a scenario wired to a retired property tool slips
    // through unnoticed (exactly how the round-8 regression hid). Asserting on
    // residue (not "must be registered") avoids flagging legitimate graph tools
    // that the mock test-brain does not wire, while still biting any property
    // tool a scenario points at.
    const offenders: Array<{ scenario: string; tool: string; hit: string }> = [];
    for (const scenario of ALL_SCENARIOS) {
      const expected = scenario.expect?.expectToolCalls ?? [];
      for (const tool of expected) {
        const hit = residueHit(tool);
        if (hit !== null) {
          offenders.push({ scenario: scenario.id, tool, hit });
        }
      }
    }
    expect(
      offenders,
      `eval scenario(s) reference a property-residue tool: ${JSON.stringify(offenders)}`
    ).toEqual([]);
  });
});
