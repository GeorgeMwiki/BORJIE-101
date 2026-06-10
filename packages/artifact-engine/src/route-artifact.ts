/**
 * `routeArtifact` — the pure surface router.
 *
 * ONE artifact is born once (Stage 0) and flows by THIS router's decision
 * plus a legible owner gesture — never by which gateway extractor happened
 * to emit it. The router reads the spec's five routing `signals` (the
 * AND-gate) and its `kind` (the artifact-class → surface table) and returns
 * the surface the artifact should render on, the reason, and the signals it
 * read (for telemetry + the "Pin to tab" affordance reasoning).
 *
 * The governing rule (the Claude / ChatGPT precedent the blueprint cites):
 * DEFAULT INLINE, BIAS TO CHAT. An artifact stays in the conversation
 * unless it earns a canvas — the owner is THINKING in the chat spine, and
 * yanking a one-line confirmation onto a canvas breaks that flow. Only a
 * substantial, self-contained, kept-or-exported deliverable graduates.
 *
 * Pure + unit-tested. No React, no I/O — a `spec` in, a decision out.
 */

import { isKnownArtifactKind, type ArtifactSignals } from './spec.js';

// ---------------------------------------------------------------------------
// 1. Surfaces — the four lenses the router can choose.
// ---------------------------------------------------------------------------

/**
 * The render surfaces. Three are INLINE flavours (they live in the
 * conversation spine, biased-to-chat) and one is the CANVAS (a workbench /
 * tab / dashboard / document lens — the chrome is chosen downstream by the
 * `UnifiedArtifactRenderer`'s `surface` prop; the router only decides
 * "inline vs canvas" and, within inline, the flavour):
 *
 *   - `inline-text`   — a fragment that only reads inside the sentence,
 *                       or an UNKNOWN kind degrading gracefully. The most
 *                       conservative, default-est surface.
 *   - `inline-chip`   — a compact self-contained bubble chip in the spine
 *                       (a small KPI / sparkline / evidence card).
 *   - `inline-action` — an affordance the owner acts on in place
 *                       (confirmation / approval / a single action).
 *   - `canvas`        — graduates out of the spine to a workbench / tab /
 *                       dashboard / document. Earns it only via the gate.
 */
export const ARTIFACT_SURFACES = [
  'inline-text',
  'inline-chip',
  'inline-action',
  'canvas',
] as const;

export type ArtifactSurface = (typeof ARTIFACT_SURFACES)[number];

// ---------------------------------------------------------------------------
// 2. The artifact-class → surface affinity table (the blueprint's table).
// ---------------------------------------------------------------------------

/**
 * The artifact-class → surface affinity table. A kind's INHERENT shape
 * pulls it toward a surface FLAVOUR before the signal gate runs:
 *
 *   - action-class kinds (approval, prefill-form, signature-pad, …) are
 *     affordances → `inline-action`;
 *   - chip-class kinds (kpi-grid, metric-sparkline, gauge, live-counter,
 *     evidence-card, …) are compact self-contained → `inline-chip`;
 *   - text-class kinds (markdown-card, code-block, …) read in the spine →
 *     `inline-text`;
 *   - everything else has no inline affinity (it's a full surface like a
 *     data-table or chart) → falls through to `inline-chip` as the inline
 *     flavour, and the gate decides whether it graduates to `canvas`.
 *
 * This table NEVER forces `canvas` — graduation is the gate's job. The
 * table only picks the INLINE flavour an artifact lands on when it does
 * NOT graduate. Unknown kinds are absent from the table → `inline-text`
 * (the safest degrade).
 */
const KIND_INLINE_FLAVOUR: Readonly<Record<string, ArtifactSurface>> = {
  // action-class — the owner acts on it in place.
  approval: 'inline-action',
  'prefill-form': 'inline-action',
  'signature-pad': 'inline-action',
  'slider-input': 'inline-action',
  'multistep-wizard': 'inline-action',
  'prompt-suggestions': 'inline-action',
  // chip-class — compact, self-contained, reads as a bubble chip.
  'kpi-grid': 'inline-chip',
  'metric-sparkline': 'inline-chip',
  gauge: 'inline-chip',
  'live-counter': 'inline-chip',
  'evidence-card': 'inline-chip',
  'notification-toast': 'inline-chip',
  // text-class — long-form, reads in the reading spine.
  'markdown-card': 'inline-text',
  'code-block': 'inline-text',
  'diff-view': 'inline-text',
  'decision-trace': 'inline-text',
};

/**
 * Kinds that, when an artifact graduates to `canvas`, are document-shaped
 * (long-form / printable). Exposed for the renderer's chrome selection +
 * tests; the router itself returns only `canvas` (the document-vs-tab
 * chrome is a downstream concern).
 */
export const DOCUMENT_CLASS_KINDS: ReadonlyArray<string> = [
  'markdown-card',
  'pdf-viewer',
  'diff-view',
  'decision-trace',
];

// ---------------------------------------------------------------------------
// 3. The decision shape.
// ---------------------------------------------------------------------------

export interface ArtifactRouteContext {
  /**
   * Optional surface the host wants to FORCE (e.g. the owner clicked
   * "Open on The Board"). When set, the router honours it and reports the
   * reason. Lets the legible owner gesture override the signal gate.
   */
  readonly forcedSurface?: ArtifactSurface;
}

export interface ArtifactRouteDecision {
  /** The chosen surface. */
  readonly surface: ArtifactSurface;
  /** Human-readable reason — for telemetry + "why did this go here?". */
  readonly reason: string;
  /** The signals the router read (echoed back for the affordance logic). */
  readonly signals: ArtifactSignals;
  /**
   * True when an INLINE artifact is eligible to be promoted to `canvas`
   * via an explicit owner gesture ("Pin to tab" / "Open on The Board").
   * Lets the lifecycle be a deliberate, legible progression — not an
   * invisible system action. Always false when already `canvas`.
   */
  readonly promotable: boolean;
}

// ---------------------------------------------------------------------------
// 4. The five-signal AND-gate. DEFAULT INLINE, bias-to-chat.
// ---------------------------------------------------------------------------

/**
 * The graduation gate: an artifact earns the `canvas` ONLY when it is a
 * real, self-contained deliverable that is kept, exported, or reused. The
 * gate is an AND of the meaningful signals — biased conservative so a
 * borderline artifact stays in the chat where the owner is thinking.
 *
 * An artifact graduates to `canvas` when it is `substantial` AND
 * `selfContained` AND (`takeOutside` OR `reused` OR `editable`):
 *
 *   - it must be `substantial` (not a one-line micro-affordance), AND
 *   - it must be `selfContained` (not a mid-sentence fragment), AND
 *   - at least one durability reason: it leaves the chat (`takeOutside`),
 *     it recurs (`reused`), or it's a workbench artifact (`editable`).
 *
 * Anything failing the gate stays inline, on the flavour the class table
 * picks. This is the literal "default inline, bias to chat" rule.
 */
function earnsCanvas(signals: ArtifactSignals): boolean {
  const durabilityReason =
    signals.takeOutside || signals.reused || signals.editable;
  return signals.substantial && signals.selfContained && durabilityReason;
}

/**
 * Route an `ArtifactSpec` to a surface. Pure: same inputs → same output.
 *
 * Decision order:
 *   1. `ctx.forcedSurface` — an explicit owner gesture wins (legible
 *      promotion / demotion).
 *   2. The five-signal AND-gate — earns `canvas` or stays inline.
 *   3. When inline, the artifact-class table picks the inline FLAVOUR;
 *      an unknown / un-tabled kind degrades to `inline-text`.
 *
 * Accepts `Pick<…>` of the fields it reads so it can route a partial /
 * never-fully-parsed spec (the generativity path: an unknown kind that
 * still routes). `signals` is required; `kind` is read as a plain string.
 */
export function routeArtifact(
  spec: { readonly kind: string; readonly signals: ArtifactSignals },
  ctx: ArtifactRouteContext = {},
): ArtifactRouteDecision {
  const signals = spec.signals;

  // (1) An explicit owner gesture overrides everything — legible promotion.
  if (ctx.forcedSurface) {
    return {
      surface: ctx.forcedSurface,
      reason: `forced to '${ctx.forcedSurface}' by an explicit host/owner gesture`,
      signals,
      promotable: ctx.forcedSurface !== 'canvas',
    };
  }

  // (2) The graduation gate.
  if (earnsCanvas(signals)) {
    const documentShaped = DOCUMENT_CLASS_KINDS.includes(spec.kind);
    return {
      surface: 'canvas',
      reason: documentShaped
        ? `graduated to canvas (document-class kind '${spec.kind}'): substantial + selfContained + durable`
        : `graduated to canvas: substantial + selfContained + (takeOutside|reused|editable)`,
      signals,
      promotable: false,
    };
  }

  // (3) Stays inline — pick the flavour from the artifact-class table.
  //     Unknown / un-tabled kinds degrade to the safest flavour:
  //     `inline-text` (which the renderer pairs with UnknownKindCard).
  const known = isKnownArtifactKind(spec.kind);
  const flavour: ArtifactSurface =
    KIND_INLINE_FLAVOUR[spec.kind] ??
    (known ? 'inline-chip' : 'inline-text');

  const reason = known
    ? `stayed inline ('${flavour}'): did not pass the five-signal canvas gate`
    : `stayed inline ('inline-text'): unknown kind '${spec.kind}' degrades gracefully`;

  return {
    surface: flavour,
    reason,
    signals,
    // An inline artifact is promotable to canvas when it is substantial +
    // selfContained — it's "almost there", so we offer the explicit gesture.
    promotable: signals.substantial && signals.selfContained,
  };
}
