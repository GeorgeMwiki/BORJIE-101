/**
 * Unified admission control — the ONE chokepoint every generated tab must pass
 * before it can be persisted or patched into a live surface.
 *
 * Before this, the pre-persist guarantees lived in three separate places: the
 * engine sealed the audit chain (`sealAuditChain`), then threw on the first
 * disallowed URL (`assertSpecUrlsAllowed`), and evidence / locale / action-label
 * integrity were not enforced at the persist seam at all. Three call sites means
 * three ways to forget one — a new persist path could ship a tab that skipped a
 * check, and a NEW guarantee had to be wired into every site by hand.
 *
 * `admitTab` collapses all of them into a single pure function returning ONE
 * typed `AdmissionResult`. The guarantees are a REGISTRY of admission rules
 * (`ADMISSION_RULES`): a future rule is one array entry, so the system is
 * closed-under-extension — no path can bypass and no new check is bolted onto a
 * call site. Unlike the throwing `assertSpecUrlsAllowed`, admission never throws
 * on input shape: it COLLECTS every violation so the API layer can return one
 * precise 422 listing all of them at once.
 *
 * Audit-seal is special: it TRANSFORMS the tab (stamps chain hashes) rather than
 * inspecting it, so it runs first, deterministically, and the sealed tab is what
 * the rules inspect and what `admitTab` returns. The stored record therefore
 * always carries chain hashes regardless of admission outcome.
 *
 * Pure / dependency-free beyond the read-only imports — callers resolve the
 * policy (egress allowlist, locale, evidence toggle, locale detector) at the
 * bootstrap seam and pass it in, keeping the package `process.env`-free.
 *
 * @module @borjie/portal-genui/admission/admit
 */

import { z } from 'zod';
import type {
  PortalTab,
  PortalTabSection,
  PortalTabWidget,
  PortalLocale,
} from '../types.js';
import {
  findDisallowedUrls,
  type UrlEgressPolicy,
} from '../security/url-egress.js';
import { sealAuditChain } from '../audit/audit-chain.js';
import { verifyRenderEffect } from '../verify/render-effect.js';

// ---------------------------------------------------------------------------
// Result shape.
// ---------------------------------------------------------------------------

/** Stable rule ids — every admission rule reports under one of these. */
export const ADMISSION_RULE_IDS = [
  'url-egress',
  'evidence-presence',
  'locale-purity',
  'action-label-binding',
  'render-effect',
] as const;

export type AdmissionRuleId = (typeof ADMISSION_RULE_IDS)[number];

/** One thing wrong with a tab. `path` is a dotted/indexed locator into the spec. */
export interface AdmissionViolation {
  /** Which admission rule fired. */
  readonly rule: AdmissionRuleId;
  /** Dotted/indexed path to the offending value within the tab. */
  readonly path: string;
  /** Human-readable, leak-safe detail for the 422 body. */
  readonly detail: string;
}

/** The single typed result every persist/patch path inspects. */
export interface AdmissionResult {
  /** True when there are zero violations. */
  readonly ok: boolean;
  /**
   * The tab with its audit chain sealed (chain hashes stamped). ALWAYS returned
   * — even when `ok` is false — so a caller that chooses to persist anyway
   * stores a sealed record. Sealing never mutates the input tab.
   */
  readonly sealedTab: PortalTab;
  /** Every violation found, across all rules. Empty iff `ok`. */
  readonly violations: ReadonlyArray<AdmissionViolation>;
}

// ---------------------------------------------------------------------------
// Policy.
// ---------------------------------------------------------------------------

/**
 * A pluggable, testable detector for "this user-visible string is in the wrong
 * language for the active locale". Returns `true` when `text` violates `locale`
 * purity (e.g. Swahili text under an `en` tab). Injected so the heavy language
 * classifier lives at the composition root and the rule stays a pure unit.
 */
export type LocaleImpurityDetector = (
  text: string,
  locale: PortalLocale,
) => boolean;

export interface AdmissionPolicy {
  /**
   * Render-egress URL allowlist. Reuses `findDisallowedUrls` (read-only). When
   * omitted, the egress rule is a no-op (test/stub mode).
   */
  readonly urlEgress?: UrlEgressPolicy;
  /**
   * When true, EVERY section must carry >=1 evidence ref. Default false for
   * back-compat — existing tabs predate the evidence contract.
   */
  readonly requireEvidence?: boolean;
  /**
   * The tab's ACTIVE render locale. When set AND a `localeDetector` is supplied,
   * user-visible strings are scanned for the wrong language. Absent ⇒ skipped.
   */
  readonly locale?: PortalLocale;
  /**
   * Pluggable language detector for the locale-purity rule. Default no-op (the
   * rule never fires) so the package needs no bundled language model.
   */
  readonly localeDetector?: LocaleImpurityDetector;
}

// ---------------------------------------------------------------------------
// Evidence contract — read off the section, optional, validated defensively.
// ---------------------------------------------------------------------------

/**
 * The OPTIONAL evidence contract a section may carry. The base `PortalTabSection`
 * is `.strict()` and does not declare `evidenceIds`; admission reads it
 * defensively via a widened schema so an unknown-but-present `evidenceIds` array
 * counts toward the requirement without the core type having to change yet.
 * Each id mirrors the brain's `evidence_id` (LMBM / intelligence corpus ref).
 */
const SectionEvidenceSchema = z
  .object({
    evidenceIds: z.array(z.string().min(1).max(200)).optional(),
  })
  .passthrough();

/** Count the evidence refs declared on a section (0 when absent/invalid). */
function countSectionEvidence(section: PortalTabSection): number {
  const parsed = SectionEvidenceSchema.safeParse(section);
  if (!parsed.success) return 0;
  return parsed.data.evidenceIds?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Action-vs-label integrity — a read-implying label over a mutating verb.
// ---------------------------------------------------------------------------

/**
 * Tool ids whose label must NOT imply a read. A binding to one of these mutates
 * state; a widget that renders "View report" over it misrepresents what the
 * button does — the exact dark-pattern the action-label rule catches. Derived
 * from the verb, not a hardcoded per-tool list, so a new mutating tool is
 * covered automatically.
 */
const MUTATING_VERB_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'create',
  'update',
  'delete',
  'request',
  'notify',
  'export',
  'recompute',
  'submit',
  'approve',
  'send',
  'post',
  'archive',
]);

/** True when a tool id's leading verb mutates state. Pure predicate. */
export function isMutatingVerb(toolId: string): boolean {
  const head = toolId.toLowerCase().split(/[_.-]/, 1)[0] ?? '';
  return MUTATING_VERB_PREFIXES.some((verb) => head === verb);
}

/** Words in a user-visible label that imply a read-only / passive action. */
const READ_IMPLYING_WORDS: ReadonlyArray<string> = Object.freeze([
  'view',
  'report',
  'read',
  'see',
  'preview',
  'show',
  'browse',
]);

/** True when a label reads as passive ("View report", "See details"). */
function labelImpliesRead(label: string): boolean {
  const lower = label.toLowerCase();
  return READ_IMPLYING_WORDS.some((word) =>
    new RegExp(`\\b${word}\\b`).test(lower),
  );
}

/**
 * The user-visible label a widget renders for its action. We treat `subtitle`
 * (the call-to-action line under the title) as the primary action label, falling
 * back to the title. A widget with no tool binding has no action to mislabel.
 */
function widgetActionLabel(widget: PortalTabWidget): string {
  return widget.subtitle ?? widget.title;
}

// ---------------------------------------------------------------------------
// Section / widget walk helpers — pure, allocation-light.
// ---------------------------------------------------------------------------

function forEachWidget(
  tab: PortalTab,
  visit: (
    section: PortalTabSection,
    sectionIndex: number,
    widget: PortalTabWidget,
    widgetIndex: number,
  ) => void,
): void {
  tab.sections.forEach((section, si) => {
    section.widgets.forEach((widget, wi) => visit(section, si, widget, wi));
  });
}

// ---------------------------------------------------------------------------
// The rule registry — closed-under-extension. A new rule is ONE entry here.
// ---------------------------------------------------------------------------

/**
 * An admission rule inspects the (already audit-sealed) tab + policy and returns
 * the violations it found. Rules NEVER throw and NEVER mutate — they only read
 * and report. Composing a new pre-persist guarantee is appending one entry.
 */
export interface AdmissionRule {
  readonly id: AdmissionRuleId;
  readonly check: (
    tab: PortalTab,
    policy: AdmissionPolicy,
  ) => ReadonlyArray<AdmissionViolation>;
}

/** URL egress — every URL-shaped string must pass the allowlist. */
const urlEgressRule: AdmissionRule = {
  id: 'url-egress',
  check: (tab, policy) => {
    if (!policy.urlEgress) return [];
    return findDisallowedUrls(tab, policy.urlEgress).map((bad) => ({
      rule: 'url-egress' as const,
      path: bad.path,
      detail: `disallowed URL '${bad.url}' (${bad.reason})`,
    }));
  },
};

/** Evidence presence — when required, every section carries >=1 evidence ref. */
const evidencePresenceRule: AdmissionRule = {
  id: 'evidence-presence',
  check: (tab, policy) => {
    if (!policy.requireEvidence) return [];
    const out: AdmissionViolation[] = [];
    tab.sections.forEach((section, si) => {
      if (countSectionEvidence(section) === 0) {
        out.push({
          rule: 'evidence-presence',
          path: `sections[${si}]`,
          detail: `section '${section.key}' has no evidence ref but evidence is required`,
        });
      }
    });
    return out;
  },
};

/** Collect the user-visible strings of one section, with their paths. */
function sectionVisibleStrings(
  section: PortalTabSection,
  si: number,
): ReadonlyArray<{ path: string; text: string }> {
  const out: { path: string; text: string }[] = [
    { path: `sections[${si}].title`, text: section.title },
  ];
  if (section.description) {
    out.push({ path: `sections[${si}].description`, text: section.description });
  }
  section.fields.forEach((field, fi) => {
    out.push({ path: `sections[${si}].fields[${fi}].label`, text: field.label });
    if (field.help) {
      out.push({ path: `sections[${si}].fields[${fi}].help`, text: field.help });
    }
  });
  section.widgets.forEach((widget, wi) => {
    out.push({
      path: `sections[${si}].widgets[${wi}].title`,
      text: widget.title,
    });
    if (widget.subtitle) {
      out.push({
        path: `sections[${si}].widgets[${wi}].subtitle`,
        text: widget.subtitle,
      });
    }
  });
  return out;
}

/** Locale purity — no wrong-language user-visible strings under the active locale. */
const localePurityRule: AdmissionRule = {
  id: 'locale-purity',
  check: (tab, policy) => {
    const { locale, localeDetector } = policy;
    if (!locale || !localeDetector) return [];
    const strings: { path: string; text: string }[] = [
      { path: 'title', text: tab.title },
      { path: 'description', text: tab.description },
    ];
    tab.sections.forEach((section, si) => {
      for (const item of sectionVisibleStrings(section, si)) {
        strings.push(item);
      }
    });
    return strings
      .filter((item) => localeDetector(item.text, locale))
      .map((item) => ({
        rule: 'locale-purity' as const,
        path: item.path,
        detail: `user-visible string is not pure '${locale}'`,
      }));
  },
};

/** Action-vs-label — a read-implying label over a mutating tool binding. */
const actionLabelBindingRule: AdmissionRule = {
  id: 'action-label-binding',
  check: (tab) => {
    const out: AdmissionViolation[] = [];
    forEachWidget(tab, (_section, si, widget, wi) => {
      const binding = widget.binding;
      if (!binding || binding.kind !== 'tool') return;
      if (!isMutatingVerb(binding.toolId)) return;
      const label = widgetActionLabel(widget);
      if (labelImpliesRead(label)) {
        out.push({
          rule: 'action-label-binding',
          path: `sections[${si}].widgets[${wi}]`,
          detail: `label '${label}' implies read but binds mutating tool '${binding.toolId}'`,
        });
      }
    });
    return out;
  },
};

/**
 * Render-effect — an independent verifier (outside the generating model) diffs
 * declared intent vs spec effect: dark patterns, read-label-over-mutating-verb,
 * surprise actions, lying charts. Only HIGH-confidence findings block admission;
 * medium/low are advisory residuals surfaced elsewhere (HITL preview / telemetry).
 */
const renderEffectRule: AdmissionRule = {
  id: 'render-effect',
  check: (tab) =>
    verifyRenderEffect(tab)
      .findings.filter((f) => f.confidence === 'high')
      .map((f) => ({
        rule: 'render-effect' as const,
        path: f.path,
        detail: `${f.kind}: ${f.detail}`,
      })),
};

/**
 * The admission registry. ORDER is stable so a caller can reason about violation
 * ordering, but admission ALWAYS runs every rule (it never short-circuits) so
 * one 422 lists every problem. Appending a rule here is the only edit a new
 * pre-persist guarantee needs.
 */
export const ADMISSION_RULES: ReadonlyArray<AdmissionRule> = Object.freeze([
  urlEgressRule,
  evidencePresenceRule,
  localePurityRule,
  actionLabelBindingRule,
  renderEffectRule,
]);

// ---------------------------------------------------------------------------
// The chokepoint.
// ---------------------------------------------------------------------------

/**
 * Admit a tab through every pre-persist guarantee in ONE pass. Pure: never
 * throws on input shape, never mutates the input. Seals the audit chain first
 * (transform), then runs every admission rule (inspect) over the sealed tab,
 * accumulating violations. `ok` is true iff zero violations.
 *
 * The engine persist/patch chokepoint should call this and store `sealedTab`;
 * the router maps a non-`ok` result to a 422 whose body is `violations`.
 */
export function admitTab(
  tab: PortalTab,
  policy: AdmissionPolicy = {},
): AdmissionResult {
  const sealedTab: PortalTab = {
    ...tab,
    audit: sealAuditChain(tab.audit),
  };

  const violations = ADMISSION_RULES.flatMap((rule) =>
    rule.check(sealedTab, policy),
  );

  return {
    ok: violations.length === 0,
    sealedTab,
    violations: Object.freeze([...violations]),
  };
}

/**
 * Thrown by the engine persist/patch chokepoint when admission fails. Carries
 * the full violation list so the API layer can emit one 422 listing every
 * problem (`{ error: 'TAB_ADMISSION_FAILED', violations }`).
 */
export class PortalGenUiAdmissionError extends Error {
  public readonly code = 'TAB_ADMISSION_FAILED' as const;
  public readonly violations: ReadonlyArray<AdmissionViolation>;

  public constructor(violations: ReadonlyArray<AdmissionViolation>) {
    super(
      `portal-genui: tab admission failed with ${violations.length} violation(s): ` +
        violations.map((v) => `${v.rule}@${v.path}`).join('; '),
    );
    this.name = 'PortalGenUiAdmissionError';
    this.violations = Object.freeze([...violations]);
  }
}
