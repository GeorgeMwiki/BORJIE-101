/**
 * Extension contract — the SINGLE canonical statement of what it takes to
 * add a new capability to `@borjie/portal-genui` without leaving a mis-wire.
 *
 * Law 2 (closed-under-extension) and Law 3 (catch the mis-wire we did not
 * imagine) both reduce to one rule: every new field/widget KIND, and every
 * new cross-cutting CONCERN, must arrive together with the artifacts the
 * runtime needs — never one half. A kind without a registry entry renders
 * nothing; a registry entry without an enum member is unreachable; a concern
 * without an admission rule is a hole the next poisoned spec walks straight
 * through. None of those is a type error — `tsc` is happy with a half-wired
 * extension. This module names the obligations so the companion test
 * (`__tests__/wiring-completeness.test.ts`) can FAIL the merge that ships one.
 *
 * Pure data + pure functions. No I/O, no React, no `process.env`. The test
 * pairs these constants against the live `types.ts` enums and the
 * `fields/widgets` registries it imports read-only.
 *
 * @module @borjie/portal-genui/integrity/extension-contract
 */

// ────────────────────────────────────────────────────────────────────
// 1. What a NEW KIND must provide (the extension checklist).
// ────────────────────────────────────────────────────────────────────

/**
 * The obligations every new field/widget kind owes. Each is a real seam in
 * the package: skip one and the kind is half-wired in a way `tsc` will not
 * catch. The wiring-completeness test asserts the live registries satisfy
 * every checklist item for every enum member, so a kind cannot appear
 * without all of them.
 *
 *   - `enum-member`   — listed in `PORTAL_TAB_FIELD_KINDS` /
 *                       `PORTAL_TAB_WIDGET_KINDS` (`types.ts`), so the Zod
 *                       `z.enum` admits it at parse time.
 *   - `registry-entry`— a `FIELD_KIND_REGISTRY` / `WIDGET_KIND_REGISTRY`
 *                       record keyed by the kind.
 *   - `renderer`      — a non-empty `rendererName` the React layer maps to a
 *                       component (this package stays React-free, so the name
 *                       is the contract).
 *   - `validator`     — fields: `buildValueValidator`; widgets: `configSchema`
 *                       — the parse-time gate on instance values / config.
 *   - `preview`       — fields: `mockValue`; widgets: `sampleConfig` — the
 *                       tab-builder preview cannot render an unknown kind.
 */
export const NEW_KIND_CHECKLIST = [
  'enum-member',
  'registry-entry',
  'renderer',
  'validator',
  'preview',
] as const;

export type NewKindObligation = (typeof NEW_KIND_CHECKLIST)[number];

// ────────────────────────────────────────────────────────────────────
// 2. The cross-cutting CONCERNS every persist/patch must clear.
// ────────────────────────────────────────────────────────────────────

/**
 * The cross-cutting concerns the persist/patch chokepoint (`engine.ts`,
 * `guardForPersist`) must clear before a generated tab is stored. Adding a
 * new concern (say a future PII scrubber) without registering it here — and
 * without an admission rule below — would let a tab slip through ungoverned.
 * The test asserts the admission-coverage map names exactly this set, so a
 * concern cannot be added in code without being declared a first-class
 * obligation.
 *
 *   - `egress`        — `assertSpecUrlsAllowed` (url-egress membrane): no
 *                       attacker URL the renderer would auto-fetch.
 *   - `audit`         — `sealAuditChain`: tamper-evident, append-only
 *                       provenance stamped at the chokepoint.
 *   - `evidence`      — CLAUDE.md "evidence-required AI output": a generated
 *                       surface must trace to its source (auditable provenance
 *                       / source conversation), never an empty chain.
 *   - `locale`        — CLAUDE.md absolute EN/SW separation: the active render
 *                       locale is authority-controlled, never free-mixed on a
 *                       generated surface.
 *   - `action-binding`— a widget `binding` resolves only to a CLOSED, vetted
 *                       resource/tool set (capability registry), never an
 *                       arbitrary table/RPC string.
 */
export const ADMISSION_CONCERNS = [
  'egress',
  'audit',
  'evidence',
  'locale',
  'action-binding',
] as const;

export type AdmissionConcern = (typeof ADMISSION_CONCERNS)[number];

/**
 * The admission-rule registry: one named rule per cross-cutting concern, each
 * pinned to the module/symbol that enforces it. This is the placeholder the
 * track brief calls for — a real admission-rule registry does not yet live in
 * the package, so this map IS the forcing function: a new concern added to
 * `ADMISSION_CONCERNS` without a matching rule here fails the test, which is
 * exactly what makes "adding a concern is forced" true by construction.
 *
 * `enforcedBy` is the symbol/path a reviewer greps to confirm the rule is
 * actually wired into `guardForPersist` (or the schema parse seam). It is a
 * documentation anchor, not an import, so this module stays free of the
 * shared files the track must not edit.
 */
export interface AdmissionRule {
  readonly concern: AdmissionConcern;
  /** Human-readable statement of the invariant the rule guarantees. */
  readonly rule: string;
  /** The symbol / module path that enforces it (grep anchor for reviewers). */
  readonly enforcedBy: string;
}

export const ADMISSION_RULE_REGISTRY: Readonly<
  Record<AdmissionConcern, AdmissionRule>
> = {
  egress: {
    concern: 'egress',
    rule: 'every URL-typed value in a persisted spec passes the egress allowlist',
    enforcedBy: 'security/url-egress.ts#assertSpecUrlsAllowed',
  },
  audit: {
    concern: 'audit',
    rule: 'the audit chain is sealed (hash-chained, append-only) at the persist chokepoint',
    enforcedBy: 'audit/audit-chain.ts#sealAuditChain',
  },
  evidence: {
    concern: 'evidence',
    rule: 'a generated surface carries auditable provenance — never an empty chain',
    enforcedBy: 'types.ts#PortalTabAuditSchema',
  },
  locale: {
    concern: 'locale',
    rule: 'the active render locale is authority-controlled (en|sw), never free-mixed',
    enforcedBy: 'types.ts#PortalLocaleSchema',
  },
  'action-binding': {
    concern: 'action-binding',
    rule: 'a widget binding resolves only to a vetted resource/tool from the closed capability registry',
    enforcedBy: 'capabilities/registry.ts#isKnownResource,isKnownTool',
  },
};

// ────────────────────────────────────────────────────────────────────
// 3. Pure helpers — set-difference + per-kind coverage.
// ────────────────────────────────────────────────────────────────────

/**
 * Symmetric set difference between two string lists. Returns the members
 * missing from each side — `{ missingFromA, missingFromB }`. Drives the
 * PARITY assertions: enum-vs-registry drift in EITHER direction is a defect.
 * Pure; inputs untouched.
 */
export function symmetricDifference(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): { readonly missingFromA: ReadonlyArray<string>; readonly missingFromB: ReadonlyArray<string> } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    missingFromA: b.filter((x) => !setA.has(x)),
    missingFromB: a.filter((x) => !setB.has(x)),
  };
}

/** A single kind's coverage against `NEW_KIND_CHECKLIST`. */
export interface KindCoverage {
  readonly kind: string;
  /** Obligations the kind FAILS to satisfy. Empty ⇒ fully wired. */
  readonly missing: ReadonlyArray<NewKindObligation>;
}

/**
 * Evaluate one kind's coverage from a flat set of booleans (one per
 * obligation). Keeps the test declarative: the test reads the live registry
 * to compute each boolean, then this reports which obligations are unmet.
 * Pure.
 */
export function evaluateKindCoverage(
  kind: string,
  satisfied: Readonly<Record<NewKindObligation, boolean>>,
): KindCoverage {
  const missing = NEW_KIND_CHECKLIST.filter((ob) => !satisfied[ob]);
  return { kind, missing };
}
