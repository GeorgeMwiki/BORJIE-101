/**
 * TOTAL-RENDERER / EXHAUSTIVENESS PROOF (Law 1).
 *
 * Law 1: every SCHEMA-VALID `PortalTab` spec is SAFE — validity implies the pure
 * renderers / normalizers never throw. The risk this guards: a future kind added
 * to a closed catalog (`PORTAL_TAB_FIELD_KINDS` / `PORTAL_TAB_WIDGET_KINDS`) that
 * a renderer or registry does NOT handle, so a spec parses fine but blows up
 * downstream — a validity-implies-no-throw violation.
 *
 * Strategy: a SEEDED, deterministic property-based fuzz.
 *   - `makeMulberry32(seed)` is the ONLY randomness source — no `Math.random`,
 *     no clock — so the whole run is reproducible (a regression reappears under
 *     the same seed).
 *   - `generatePortalTabSpec` emits specs that are in-bounds BY CONSTRUCTION and
 *     vary every field kind, every widget kind, random section/field/widget
 *     counts, and edge sizes at the schema bounds.
 *   - Assertions:
 *       (a) `PortalTabSchema.parse` ACCEPTS every generated spec (generator stays
 *           in-bounds — no false rejections);
 *       (b) the pure renderers / normalizers NEVER throw on a valid spec;
 *       (c) EXHAUSTIVENESS — the covered-set of kinds the fuzz exercised EQUALS
 *           the catalog set, so an unhandled NEW kind surfaces here.
 */

import { describe, it, expect } from 'vitest';
import {
  PortalTabSchema,
  parsePortalTab,
  safeParsePortalTab,
  collectTabFields,
  tabCollectsRecords,
  PORTAL_TAB_FIELD_KINDS,
  PORTAL_TAB_WIDGET_KINDS,
  type PortalTabFieldKind,
  type PortalTabWidgetKind,
} from '../types.js';
import {
  getFieldKindMetadata,
  buildFieldValueValidator,
  buildMockRecordForFields,
} from '../fields/registry.js';
import {
  getWidgetKindMetadata,
  parseWidgetConfig,
} from '../widgets/registry.js';
import {
  buildRecordValidator,
  validateRecordAgainstTab,
} from '../persistence/record-validator.js';
import { makeMulberry32 } from '../totality/prng.js';
import {
  generatePortalTabSpec,
  type CoverageSinks,
} from '../totality/spec-generator.js';

// Fixed integer seed corpus — iterated deterministically. Mixing small, prime,
// and large values spreads the mulberry32 stream across distinct regions.
const SEEDS: ReadonlyArray<number> = [
  1, 2, 3, 7, 11, 13, 17, 23, 42, 99, 101, 257, 1009, 4096, 8675, 31337, 65521,
  131071, 999983, 1234567,
];

/**
 * Run EVERY pure renderer / normalizer the package exposes against a valid tab.
 * Any throw here is a Law-1 violation (valid spec ⇒ must not throw). Returns the
 * derived artifacts so the caller can sanity-check shapes too.
 */
function exerciseRenderers(tab: ReturnType<typeof parsePortalTab>): void {
  // Pure flatten + the record opt-in predicate.
  const fields = collectTabFields(tab);
  tabCollectsRecords(tab);

  // Per-field: registry dispatch + value-validator construction + mock value.
  for (const field of fields) {
    const meta = getFieldKindMetadata(field.kind);
    expect(meta.kind).toBe(field.kind);
    buildFieldValueValidator(field); // must not throw for any valid field
  }
  buildMockRecordForFields(fields); // pure normalizer over every field-kind

  // Per-widget: registry dispatch + config normalization (null ⇒ defaultConfig).
  for (const section of tab.sections) {
    for (const widget of section.widgets) {
      const meta = getWidgetKindMetadata(widget.kind);
      expect(meta.kind).toBe(widget.kind);
      parseWidgetConfig(widget); // null config ⇒ defaults; never throws on valid
    }
  }

  // The record-collection normalizer composes per-field validators into one
  // object validator. Building it must never throw for a valid tab.
  buildRecordValidator(fields);
  // And validating the tab's OWN mock record must not throw (may pass or fail
  // validation, but must not raise).
  expect(() =>
    validateRecordAgainstTab(tab, buildMockRecordForFields(fields)),
  ).not.toThrow();
}

describe('spec-space fuzz — Law 1 (valid ⇒ safe)', () => {
  // Shared covered-set accumulated across every seed × every forced kind.
  const fieldKindsCovered = new Set<PortalTabFieldKind>();
  const widgetKindsCovered = new Set<PortalTabWidgetKind>();
  let totalSpecs = 0;

  const sinks: CoverageSinks = {
    markFieldKind: (k) => fieldKindsCovered.add(k),
    markWidgetKind: (k) => widgetKindsCovered.add(k),
  };

  it('(a)+(b) every generated spec parses AND survives every pure renderer', () => {
    // For each seed we generate a base spec PLUS one spec per catalog kind with
    // that kind PINNED into the first section — guaranteeing exhaustiveness is
    // reached deterministically, not left to chance.
    for (const seed of SEEDS) {
      const rng = makeMulberry32(seed);

      // A handful of fully-random specs per seed.
      for (let r = 0; r < 4; r += 1) {
        const spec = generatePortalTabSpec(rng, sinks);
        const parsed = PortalTabSchema.safeParse(spec);
        expect(parsed.success).toBe(true);
        if (!parsed.success) {
          throw new Error(
            `seed ${seed} rep ${r}: spec rejected — ${parsed.error.message}`,
          );
        }
        expect(() => exerciseRenderers(parsed.data)).not.toThrow();
        totalSpecs += 1;
      }

      // Force every field kind through, one per spec.
      for (const kind of PORTAL_TAB_FIELD_KINDS) {
        const spec = generatePortalTabSpec(rng, sinks, { forceFieldKind: kind });
        const parsed = parsePortalTab(spec); // throws on rejection ⇒ fails test
        exerciseRenderers(parsed);
        totalSpecs += 1;
      }

      // Force every widget kind through, one per spec.
      for (const kind of PORTAL_TAB_WIDGET_KINDS) {
        const spec = generatePortalTabSpec(rng, sinks, { forceWidgetKind: kind });
        const parsed = parsePortalTab(spec);
        exerciseRenderers(parsed);
        totalSpecs += 1;
      }
    }

    // Sanity: we actually ran a meaningful volume.
    expect(totalSpecs).toBeGreaterThan(
      SEEDS.length * (4 + PORTAL_TAB_FIELD_KINDS.length + PORTAL_TAB_WIDGET_KINDS.length) - 1,
    );
  });

  it('(c) EXHAUSTIVENESS — covered field kinds EQUAL the catalog set', () => {
    const catalog = new Set<PortalTabFieldKind>(PORTAL_TAB_FIELD_KINDS);
    // Covered ⊆ catalog (no stray kinds) AND catalog ⊆ covered (none missed).
    for (const k of fieldKindsCovered) expect(catalog.has(k)).toBe(true);
    const missing = PORTAL_TAB_FIELD_KINDS.filter((k) => !fieldKindsCovered.has(k));
    expect(missing).toEqual([]);
    expect(fieldKindsCovered.size).toBe(PORTAL_TAB_FIELD_KINDS.length);
  });

  it('(c) EXHAUSTIVENESS — covered widget kinds EQUAL the catalog set', () => {
    const catalog = new Set<PortalTabWidgetKind>(PORTAL_TAB_WIDGET_KINDS);
    for (const k of widgetKindsCovered) expect(catalog.has(k)).toBe(true);
    const missing = PORTAL_TAB_WIDGET_KINDS.filter(
      (k) => !widgetKindsCovered.has(k),
    );
    expect(missing).toEqual([]);
    expect(widgetKindsCovered.size).toBe(PORTAL_TAB_WIDGET_KINDS.length);
  });

  it('every catalog kind has registry metadata (no orphan kind)', () => {
    // A NEW kind added to the enum but NOT to a registry would throw here —
    // the same surface a renderer dispatch would hit.
    for (const kind of PORTAL_TAB_FIELD_KINDS) {
      expect(() => getFieldKindMetadata(kind)).not.toThrow();
    }
    for (const kind of PORTAL_TAB_WIDGET_KINDS) {
      expect(() => getWidgetKindMetadata(kind)).not.toThrow();
    }
  });
});

describe('spec-space fuzz — determinism (reproducibility guarantee)', () => {
  it('the same seed replays the identical spec (no clock / platform RNG)', () => {
    const noopSinks: CoverageSinks = {
      markFieldKind: () => {},
      markWidgetKind: () => {},
    };
    const a = generatePortalTabSpec(makeMulberry32(424242), noopSinks);
    const b = generatePortalTabSpec(makeMulberry32(424242), noopSinks);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    // A different seed must (with overwhelming probability) differ.
    const c = generatePortalTabSpec(makeMulberry32(424243), noopSinks);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('a replayed spec round-trips cleanly through the validator', () => {
    const noopSinks: CoverageSinks = {
      markFieldKind: () => {},
      markWidgetKind: () => {},
    };
    const spec = generatePortalTabSpec(makeMulberry32(7), noopSinks);
    expect(safeParsePortalTab(spec)).not.toBeNull();
  });
});
