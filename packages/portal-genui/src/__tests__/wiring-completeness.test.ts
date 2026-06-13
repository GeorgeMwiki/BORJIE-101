/**
 * Wiring-completeness / mis-wire detector — Law 2 (closed-under-extension)
 * + Law 3 (catch the mis-wire we did not imagine).
 *
 * These are STATIC invariants over the package's own surface. They make a
 * whole class of future mis-wire impossible to merge: a field/widget kind
 * that ships without a registry entry, a registry entry with no enum member
 * (an unreachable orphan), a renderer/validator/preview gap, or a new
 * cross-cutting concern added without an admission rule. None of those is a
 * TypeScript error — `tsc` happily compiles a half-wired extension — so the
 * only thing standing between a poisoned/incomplete spec and production is a
 * test that asserts the maps line up. This is that test.
 *
 * Everything is imported READ-ONLY. The detector never mutates a shared file;
 * it only reads the live enums (`types.ts`), the field/widget registries, the
 * capability + patch op surfaces, and the extension contract this track owns
 * (`../integrity/extension-contract.ts`). Deterministic + fast — no I/O.
 */

import { describe, it, expect } from 'vitest';

// ── Live enums (read-only) ──────────────────────────────────────────
import {
  PORTAL_TAB_FIELD_KINDS,
  PORTAL_TAB_WIDGET_KINDS,
  PORTAL_DASHBOARD_KIND_NAMES,
  PORTAL_LOCALES,
  PortalTabFieldKindSchema,
  PortalTabWidgetKindSchema,
  type PortalTabFieldKind,
  type PortalTabWidgetKind,
} from '../types.js';

// ── Live registries (read-only) ─────────────────────────────────────
import { FIELD_KIND_REGISTRY, ALL_FIELD_KINDS } from '../fields/registry.js';
import { WIDGET_KIND_REGISTRY, ALL_WIDGET_KINDS } from '../widgets/registry.js';

// ── Capability + patch surfaces (read-only) ─────────────────────────
import {
  PORTAL_QUERY_RESOURCES,
  PORTAL_QUERY_RESOURCE_LABELS,
  PORTAL_TOOL_IDS,
  PORTAL_TOOL_LABELS,
  isKnownResource,
  isKnownTool,
} from '../capabilities/registry.js';

// ── The extension contract this track owns ──────────────────────────
import {
  NEW_KIND_CHECKLIST,
  ADMISSION_CONCERNS,
  ADMISSION_RULE_REGISTRY,
  symmetricDifference,
  evaluateKindCoverage,
  type NewKindObligation,
} from '../integrity/extension-contract.js';

// ─────────────────────────────────────────────────────────────────────
// PARITY — enum ⇔ registry, both directions. No drift.
// ─────────────────────────────────────────────────────────────────────

describe('PARITY: field kinds — enum ⇔ registry (set equality both ways)', () => {
  it('every field-kind enum member has a registry entry and vice versa', () => {
    const enumKinds = [...PORTAL_TAB_FIELD_KINDS];
    const registryKinds = Object.keys(FIELD_KIND_REGISTRY);
    const { missingFromA, missingFromB } = symmetricDifference(
      enumKinds,
      registryKinds,
    );
    expect(
      missingFromB,
      `enum field kinds with NO registry entry (will render nothing): ${missingFromB.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromA,
      `registry field entries with NO enum member (unreachable orphan): ${missingFromA.join(', ')}`,
    ).toEqual([]);
  });

  it('each registry entry is self-keyed (entry.kind === its map key)', () => {
    for (const [key, meta] of Object.entries(FIELD_KIND_REGISTRY)) {
      expect(meta.kind, `field registry key '${key}' mis-keyed`).toBe(key);
    }
  });

  it('ALL_FIELD_KINDS is the same set as the enum (no shadow list)', () => {
    expect([...ALL_FIELD_KINDS].sort()).toEqual([...PORTAL_TAB_FIELD_KINDS].sort());
  });

  it('the Zod field-kind enum admits exactly the registry kinds', () => {
    for (const kind of Object.keys(FIELD_KIND_REGISTRY)) {
      expect(PortalTabFieldKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(PortalTabFieldKindSchema.safeParse('not_a_kind').success).toBe(false);
  });
});

describe('PARITY: widget kinds — enum ⇔ registry (set equality both ways)', () => {
  it('every widget-kind enum member has a registry entry and vice versa', () => {
    const enumKinds = [...PORTAL_TAB_WIDGET_KINDS];
    const registryKinds = Object.keys(WIDGET_KIND_REGISTRY);
    const { missingFromA, missingFromB } = symmetricDifference(
      enumKinds,
      registryKinds,
    );
    expect(
      missingFromB,
      `enum widget kinds with NO registry entry: ${missingFromB.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromA,
      `registry widget entries with NO enum member (orphan): ${missingFromA.join(', ')}`,
    ).toEqual([]);
  });

  it('each registry entry is self-keyed (entry.kind === its map key)', () => {
    for (const [key, meta] of Object.entries(WIDGET_KIND_REGISTRY)) {
      expect(meta.kind, `widget registry key '${key}' mis-keyed`).toBe(key);
    }
  });

  it('ALL_WIDGET_KINDS is the same set as the enum (no shadow list)', () => {
    expect([...ALL_WIDGET_KINDS].sort()).toEqual(
      [...PORTAL_TAB_WIDGET_KINDS].sort(),
    );
  });

  it('the Zod widget-kind enum admits exactly the registry kinds', () => {
    for (const kind of Object.keys(WIDGET_KIND_REGISTRY)) {
      expect(PortalTabWidgetKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(PortalTabWidgetKindSchema.safeParse('not_a_kind').success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// NO-ORPHAN — every capability symbol is reachable / consistent.
// ─────────────────────────────────────────────────────────────────────

describe('NO-ORPHAN: capability registry — resource/tool labels match the enums', () => {
  it('every query resource has a label and vice versa (no orphan label)', () => {
    const { missingFromA, missingFromB } = symmetricDifference(
      [...PORTAL_QUERY_RESOURCES],
      Object.keys(PORTAL_QUERY_RESOURCE_LABELS),
    );
    expect(
      missingFromB,
      `query resources with NO label: ${missingFromB.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromA,
      `resource labels with NO enum member (orphan): ${missingFromA.join(', ')}`,
    ).toEqual([]);
  });

  it('every tool id has a label and vice versa (no orphan label)', () => {
    const { missingFromA, missingFromB } = symmetricDifference(
      [...PORTAL_TOOL_IDS],
      Object.keys(PORTAL_TOOL_LABELS),
    );
    expect(
      missingFromB,
      `tool ids with NO label: ${missingFromB.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromA,
      `tool labels with NO enum member (orphan): ${missingFromA.join(', ')}`,
    ).toEqual([]);
  });

  it('the parse-time guards admit exactly the registered names', () => {
    for (const resource of PORTAL_QUERY_RESOURCES) {
      expect(isKnownResource(resource)).toBe(true);
    }
    for (const tool of PORTAL_TOOL_IDS) {
      expect(isKnownTool(tool)).toBe(true);
    }
    // A binding the LLM could hallucinate must be rejected.
    expect(isKnownResource('users_secret_table')).toBe(false);
    expect(isKnownTool('rm_minus_rf')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// EXTENSION CHECKLIST — every kind satisfies every obligation.
// ─────────────────────────────────────────────────────────────────────

/** Compute one field kind's obligation booleans from the live registry. */
function fieldObligations(
  kind: PortalTabFieldKind,
): Record<NewKindObligation, boolean> {
  const meta = FIELD_KIND_REGISTRY[kind];
  return {
    'enum-member': PORTAL_TAB_FIELD_KINDS.includes(kind),
    'registry-entry': Boolean(meta),
    renderer: Boolean(meta && meta.rendererName.length > 0),
    validator: typeof meta?.buildValueValidator === 'function',
    // `mockValue` is the field preview; `undefined` means no preview wired.
    preview: meta !== undefined && meta.mockValue !== undefined,
  };
}

/** Compute one widget kind's obligation booleans from the live registry. */
function widgetObligations(
  kind: PortalTabWidgetKind,
): Record<NewKindObligation, boolean> {
  const meta = WIDGET_KIND_REGISTRY[kind];
  return {
    'enum-member': PORTAL_TAB_WIDGET_KINDS.includes(kind),
    'registry-entry': Boolean(meta),
    renderer: Boolean(meta && meta.rendererName.length > 0),
    validator: Boolean(meta && meta.configSchema),
    preview: meta !== undefined && meta.sampleConfig !== undefined,
  };
}

describe('EXTENSION CHECKLIST: every field kind provides renderer/validator/preview', () => {
  it.each([...PORTAL_TAB_FIELD_KINDS])(
    "field kind '%s' satisfies the full new-kind checklist",
    (kind) => {
      const coverage = evaluateKindCoverage(kind, fieldObligations(kind));
      expect(
        coverage.missing,
        `field kind '${kind}' is missing: ${coverage.missing.join(', ')}`,
      ).toEqual([]);
    },
  );
});

describe('EXTENSION CHECKLIST: every widget kind provides renderer/validator/preview', () => {
  it.each([...PORTAL_TAB_WIDGET_KINDS])(
    "widget kind '%s' satisfies the full new-kind checklist",
    (kind) => {
      const coverage = evaluateKindCoverage(kind, widgetObligations(kind));
      expect(
        coverage.missing,
        `widget kind '${kind}' is missing: ${coverage.missing.join(', ')}`,
      ).toEqual([]);
    },
  );

  it('the canonical checklist names exactly the five obligations', () => {
    expect([...NEW_KIND_CHECKLIST]).toEqual([
      'enum-member',
      'registry-entry',
      'renderer',
      'validator',
      'preview',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ADMISSION COVERAGE — one rule per cross-cutting concern. Adding a
// concern is FORCED: the rule registry must name exactly the concerns.
// ─────────────────────────────────────────────────────────────────────

describe('ADMISSION COVERAGE: a rule exists per cross-cutting concern', () => {
  it('the rule registry names exactly the declared concerns (set equality)', () => {
    const ruleConcerns = Object.keys(ADMISSION_RULE_REGISTRY);
    const { missingFromA, missingFromB } = symmetricDifference(
      [...ADMISSION_CONCERNS],
      ruleConcerns,
    );
    expect(
      missingFromB,
      `concerns with NO admission rule (a hole a poisoned spec walks through): ${missingFromB.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromA,
      `admission rules naming an undeclared concern: ${missingFromA.join(', ')}`,
    ).toEqual([]);
  });

  it('the five non-negotiable concerns are all present', () => {
    for (const concern of [
      'egress',
      'audit',
      'evidence',
      'locale',
      'action-binding',
    ] as const) {
      expect(ADMISSION_CONCERNS).toContain(concern);
    }
  });

  it('every rule is self-keyed and pins a non-empty enforcedBy anchor', () => {
    for (const [key, rule] of Object.entries(ADMISSION_RULE_REGISTRY)) {
      expect(rule.concern, `rule '${key}' mis-keyed`).toBe(key);
      expect(rule.rule.length, `rule '${key}' has empty statement`).toBeGreaterThan(0);
      expect(
        rule.enforcedBy.length,
        `rule '${key}' has no enforcedBy grep anchor`,
      ).toBeGreaterThan(0);
    }
  });

  it('the locale concern covers exactly the supported render locales', () => {
    // Guards against a third locale being added without re-considering the
    // EN/SW absolute-separation rule (CLAUDE.md).
    expect([...PORTAL_LOCALES].sort()).toEqual(['en', 'sw']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// MIRROR DRIFT — the genui_part escape hatch stays within the dashboard
// catalog (no widget can forward to a primitive that does not exist).
// ─────────────────────────────────────────────────────────────────────

describe('NO-ORPHAN: genui_part forwards only to known dashboard primitives', () => {
  it('the dashboard-kind mirror is non-empty and frozen-shaped', () => {
    // A `genui_part` widget MUST carry a `genuiKind` from this list
    // (enforced by PortalTabWidgetSchema). An empty mirror would strand the
    // escape hatch.
    expect(PORTAL_DASHBOARD_KIND_NAMES.length).toBeGreaterThan(0);
    // The list is `as const`; assert uniqueness so a duplicated primitive
    // cannot silently mask a missing one.
    const unique = new Set(PORTAL_DASHBOARD_KIND_NAMES);
    expect(unique.size).toBe(PORTAL_DASHBOARD_KIND_NAMES.length);
  });
});
