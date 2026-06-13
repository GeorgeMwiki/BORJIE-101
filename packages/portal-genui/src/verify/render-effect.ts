/**
 * Independent render-effect verifier — Law 3: a checker that lives OUTSIDE the
 * generating model, diffing the tab's DECLARED intent against the effect its
 * spec would actually have when rendered. It is the unknown-unknown-in-design
 * detector: a self-grading composer always rates its own output well, so the
 * only honest signal comes from a separate, deterministic critic that re-reads
 * the finished spec the way an adversary (or a fooled user) would.
 *
 * It catches the manipulation / mis-design classes a self-eval misses:
 *
 *   - DARK-PATTERN lint — pre-checked consent (a checkbox/toggle defaulting
 *     `true` whose copy mentions consent/subscribe/agree/marketing/opt-in), a
 *     required+readonly contradiction (mandatory yet un-fillable), and the
 *     interface-interference shape of a consent field hidden from list views.
 *   - LABEL/VERB divergence — a widget whose label implies READ ('view',
 *     'see', 'report', …) but binds a MUTATING tool, and the inverse (an
 *     action-verb label bound to a read-only query).
 *   - SURPRISE-ACTION — an action affordance (mutating tool binding) on a tab
 *     whose `declaredIntent` was read-only / a tracker.
 *   - CHART-TRUTH (`checkChartTruth`) — a pure hook flagging a rendered series
 *     that diverges from the queried truth, mixes currencies, or confuses
 *     units; a home for the lying-chart detector, tested with synthetic arrays.
 *
 * It NEVER throws and NEVER blocks on its own: it collects findings. When it is
 * uncertain it DEFAULTS TO ALLOW but emits a low-confidence finding so the
 * residual is still instrumented (the Sentinel-Lattice doctrine — you cannot
 * enumerate unknown unknowns, but you can record the residuals they leave).
 *
 * Pure / dependency-free: it reads a `PortalTab` (and an optional declared
 * intent) and returns a structured verdict; resolving / blocking on that
 * verdict is the caller's job (admission rule + persist-time shadow detector).
 *
 * @module @borjie/portal-genui/verify/render-effect
 */

import type {
  PortalTab,
  PortalTabField,
  PortalTabWidget,
  PortalTabWidgetBinding,
} from '../types.js';
import { isKnownTool, type PortalToolId } from '../capabilities/registry.js';

// ---------------------------------------------------------------------------
// Finding shape
// ---------------------------------------------------------------------------

/** The class of render-effect issue a finding belongs to. */
export type RenderEffectFindingKind =
  | 'dark-pattern.prechecked-consent'
  | 'dark-pattern.required-readonly'
  | 'dark-pattern.hidden-consent'
  | 'label-verb.read-label-mutates'
  | 'label-verb.action-label-reads'
  | 'surprise-action.mutating-on-tracker'
  | 'chart-truth.length-mismatch'
  | 'chart-truth.value-divergence'
  | 'chart-truth.mixed-currency'
  | 'chart-truth.unit-confusion';

/** Confidence the verifier has that a finding is a real problem (not a guess). */
export type RenderEffectConfidence = 'low' | 'medium' | 'high';

export interface RenderEffectFinding {
  readonly kind: RenderEffectFindingKind;
  /** Dotted/indexed path to the offending node within the spec. */
  readonly path: string;
  /** Human-readable explanation of what the render would actually do. */
  readonly detail: string;
  readonly confidence: RenderEffectConfidence;
}

export interface RenderEffectVerdict {
  /** True when nothing was flagged. Findings can be advisory (low confidence). */
  readonly ok: boolean;
  readonly findings: ReadonlyArray<RenderEffectFinding>;
}

/**
 * The declared intent the composer claimed for this tab. Optional — when the
 * caller knows the tab was requested as a read-only view / tracker, the
 * verifier can flag mutating affordances that contradict that promise. The
 * shape mirrors the brain's intent envelope loosely so callers can pass a
 * subset.
 */
export interface DeclaredRenderIntent {
  /**
   * The promised disposition of the tab. `read-only` / `tracker` means "this
   * surface only displays/records, it does not act"; `interactive` /
   * `actionable` means actions are expected and welcome.
   */
  readonly disposition?: 'read-only' | 'tracker' | 'interactive' | 'actionable';
  /** Free-text intent (e.g. the user's original ask) — used as a weak signal. */
  readonly summary?: string;
}

// ---------------------------------------------------------------------------
// Verb / label lexicons — small, lowercase, word-boundary matched.
// ---------------------------------------------------------------------------

/** Label tokens that promise the affordance only READS / displays. */
const READ_LABEL_TOKENS: ReadonlyArray<string> = [
  'view',
  'see',
  'report',
  'overview',
  'summary',
  'list',
  'show',
  'browse',
  'preview',
  'history',
  'monitor',
  'track',
  'display',
  'read',
];

/** Label tokens that promise the affordance MUTATES / acts. */
const ACTION_LABEL_TOKENS: ReadonlyArray<string> = [
  'create',
  'add',
  'new',
  'delete',
  'remove',
  'send',
  'submit',
  'notify',
  'request',
  'export',
  'schedule',
  'approve',
  'reject',
  'update',
  'edit',
  'save',
  'run',
  'trigger',
];

/** Consent-shaped copy that makes a defaulted-true toggle a dark pattern. */
const CONSENT_TOKENS: ReadonlyArray<string> = [
  'consent',
  'subscribe',
  'agree',
  'opt-in',
  'opt in',
  'marketing',
  'newsletter',
  'terms',
  'share my',
  'i accept',
  'i agree',
];

/**
 * Tool ids that are read-mostly / non-mutating. Everything else in the
 * capability registry's tool set is treated as a MUTATION for divergence
 * purposes. Kept as an explicit allowlist so a NEW tool defaults to "mutating"
 * (fail-safe: an unclassified tool is assumed to act).
 */
const READ_MOSTLY_TOOLS: ReadonlySet<PortalToolId> = new Set<PortalToolId>([
  'export_records',
  'recompute_royalty_estimate',
]);

// ---------------------------------------------------------------------------
// Token helpers (pure)
// ---------------------------------------------------------------------------

/** Lowercased haystack contains the token as a whole word / phrase. */
function containsToken(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function matchesAny(
  haystack: string,
  tokens: ReadonlyArray<string>,
): string | null {
  for (const token of tokens) {
    if (containsToken(haystack, token)) return token;
  }
  return null;
}

/** A tool binding is mutating unless it is on the read-mostly allowlist. */
function bindingIsMutatingTool(binding: PortalTabWidgetBinding): boolean {
  if (binding.kind !== 'tool') return false;
  // An unknown tool would be rejected at parse time, but be defensive here.
  if (!isKnownTool(binding.toolId)) return true;
  return !READ_MOSTLY_TOOLS.has(binding.toolId);
}

// ---------------------------------------------------------------------------
// Detector: dark-pattern lint over fields
// ---------------------------------------------------------------------------

function lintField(
  field: PortalTabField,
  path: string,
): ReadonlyArray<RenderEffectFinding> {
  const out: RenderEffectFinding[] = [];
  const copy = `${field.label} ${field.help ?? ''} ${field.placeholder ?? ''}`;

  const isToggleish = field.kind === 'checkbox' || field.kind === 'toggle';
  const defaultsTrue = field.default === true;
  const consentToken = matchesAny(copy, CONSENT_TOKENS);

  // Pre-checked consent: a consent-shaped toggle defaulting on.
  if (isToggleish && defaultsTrue && consentToken) {
    out.push({
      kind: 'dark-pattern.prechecked-consent',
      path,
      detail:
        `consent-shaped ${field.kind} '${field.key}' defaults to checked ` +
        `(matched '${consentToken}') — opt-in must default OFF`,
      confidence: 'high',
    });
  }

  // A defaulted-true toggle whose copy is NOT obviously consent is a softer
  // signal — default-allow but emit a low-confidence residual.
  if (isToggleish && defaultsTrue && !consentToken) {
    out.push({
      kind: 'dark-pattern.prechecked-consent',
      path,
      detail:
        `${field.kind} '${field.key}' defaults to checked; verify it is not a ` +
        `pre-selected opt-in the user did not ask for`,
      confidence: 'low',
    });
  }

  // Required + readonly contradiction: mandatory yet un-fillable by the user.
  if (field.required === true && field.readonly === true) {
    out.push({
      kind: 'dark-pattern.required-readonly',
      path,
      detail:
        `field '${field.key}' is both required and readonly — the user can ` +
        `never satisfy it, which can trap a form open`,
      confidence: 'high',
    });
  }

  // Interface interference: a consent toggle hidden from list views so the
  // user is less likely to notice / revisit it.
  if (isToggleish && consentToken && field.hiddenInList === true) {
    out.push({
      kind: 'dark-pattern.hidden-consent',
      path,
      detail:
        `consent-shaped ${field.kind} '${field.key}' is hidden in list views ` +
        `(matched '${consentToken}') — interface-interference shape`,
      confidence: 'medium',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Detector: label/verb divergence + surprise-action over widgets
// ---------------------------------------------------------------------------

function lintWidget(
  widget: PortalTabWidget,
  path: string,
  declaredIntent: DeclaredRenderIntent | undefined,
): ReadonlyArray<RenderEffectFinding> {
  const out: RenderEffectFinding[] = [];
  const binding = widget.binding;
  if (!binding) return out;

  const copy = `${widget.title} ${widget.subtitle ?? ''}`;
  const readToken = matchesAny(copy, READ_LABEL_TOKENS);
  const actionToken = matchesAny(copy, ACTION_LABEL_TOKENS);
  const mutates = bindingIsMutatingTool(binding);
  const isQuery = binding.kind === 'query';

  // Read-label that actually mutates: the most dangerous divergence — a "View
  // payroll" button that fires create_mining_task.
  if (mutates && readToken && !actionToken) {
    out.push({
      kind: 'label-verb.read-label-mutates',
      path,
      detail:
        `widget '${widget.key}' label implies read ('${readToken}') but binds ` +
        `mutating tool '${(binding as { toolId: string }).toolId}'`,
      confidence: 'high',
    });
  }

  // Action-label bound to a pure read: less harmful but still misleading (a
  // "Create reminder" button that only lists rows). Default-allow at lower
  // confidence — the label may be aspirational copy.
  if (isQuery && actionToken && !readToken) {
    out.push({
      kind: 'label-verb.action-label-reads',
      path,
      detail:
        `widget '${widget.key}' label implies an action ('${actionToken}') but ` +
        `only queries resource '${(binding as { resource: string }).resource}'`,
      confidence: 'medium',
    });
  }

  // Surprise-action: a mutating affordance on a tab the composer declared
  // read-only / a tracker.
  if (
    mutates &&
    (declaredIntent?.disposition === 'read-only' ||
      declaredIntent?.disposition === 'tracker')
  ) {
    out.push({
      kind: 'surprise-action.mutating-on-tracker',
      path,
      detail:
        `widget '${widget.key}' binds mutating tool ` +
        `'${(binding as { toolId: string }).toolId}' on a tab declared ` +
        `'${declaredIntent.disposition}' — an unrequested action affordance`,
      confidence: 'high',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public: verifyRenderEffect
// ---------------------------------------------------------------------------

/**
 * Diff a finished tab's declared intent against the effect its spec would have
 * when rendered. Collects findings across all detectors; NEVER throws. When a
 * detector is uncertain it defaults to allow and emits a low-confidence finding
 * so the residual is still instrumented.
 *
 * `ok` is true only when zero findings were collected. Callers decide how to
 * act on confidence (e.g. block high, log low) — this function does not.
 */
export function verifyRenderEffect(
  tab: PortalTab,
  declaredIntent?: DeclaredRenderIntent,
): RenderEffectVerdict {
  const findings: RenderEffectFinding[] = [];

  // Guard against a malformed input rather than throwing — a verifier that
  // crashes is worse than one that abstains.
  const sections = Array.isArray(tab?.sections) ? tab.sections : [];

  sections.forEach((section, si) => {
    const sectionPath = `sections[${si}](${section?.key ?? '?'})`;

    const fields = Array.isArray(section?.fields) ? section.fields : [];
    fields.forEach((field, fi) => {
      findings.push(...lintField(field, `${sectionPath}.fields[${fi}]`));
    });

    const widgets = Array.isArray(section?.widgets) ? section.widgets : [];
    widgets.forEach((widget, wi) => {
      findings.push(
        ...lintWidget(widget, `${sectionPath}.widgets[${wi}]`, declaredIntent),
      );
    });
  });

  return { ok: findings.length === 0, findings: Object.freeze(findings) };
}

// ---------------------------------------------------------------------------
// Public: checkChartTruth — the lying-chart detector (pure, synthetic-tested)
// ---------------------------------------------------------------------------

/** One series point as the renderer would draw it / as the query returned it. */
export interface ChartSeriesPoint {
  /** The numeric magnitude plotted / fetched. */
  readonly value: number;
  /** Optional ISO-4217 currency this value is denominated in. */
  readonly currencyCode?: string;
  /** Optional unit token (e.g. 'kg', 'tonnes', '%', 'count'). */
  readonly unit?: string;
}

export interface ChartTruthOptions {
  /**
   * Relative tolerance for value divergence (fraction, e.g. 0.001 = 0.1%).
   * A point flags when `|rendered - queried| > tolerance * max(1, |queried|)`.
   * Default 0.0001 (0.01%) — charts should plot what was queried.
   */
  readonly relativeTolerance?: number;
}

const DEFAULT_CHART_TOLERANCE = 0.0001;

/**
 * Compare the values a chart RENDERED against the values the query actually
 * RETURNED. Flags the lying-chart classes:
 *
 *   - length-mismatch  — the rendered series has a different point count than
 *     the queried truth (dropped / injected points).
 *   - value-divergence — a rendered magnitude differs from the queried one
 *     beyond tolerance (the bar is taller than the data).
 *   - mixed-currency   — the rendered series mixes ISO currencies (visually
 *     comparable bars that are not commensurable).
 *   - unit-confusion   — the rendered series mixes units (kg vs tonnes), or a
 *     point's unit disagrees with the queried point's unit at that index.
 *
 * Pure + dependency-free; designed to be exercised with synthetic arrays.
 * NEVER throws — a malformed input yields a low-confidence advisory finding
 * rather than an exception.
 */
export function checkChartTruth(
  renderedValues: ReadonlyArray<ChartSeriesPoint>,
  queriedValues: ReadonlyArray<ChartSeriesPoint>,
  options: ChartTruthOptions = {},
): RenderEffectVerdict {
  const findings: RenderEffectFinding[] = [];

  if (!Array.isArray(renderedValues) || !Array.isArray(queriedValues)) {
    return {
      ok: false,
      findings: Object.freeze([
        {
          kind: 'chart-truth.value-divergence',
          path: 'chart',
          detail: 'chart-truth inputs were not arrays — cannot verify',
          confidence: 'low',
        },
      ]),
    };
  }

  const tolerance = options.relativeTolerance ?? DEFAULT_CHART_TOLERANCE;

  // Length mismatch — points dropped or injected between query and render.
  if (renderedValues.length !== queriedValues.length) {
    findings.push({
      kind: 'chart-truth.length-mismatch',
      path: 'chart.series',
      detail:
        `rendered series has ${renderedValues.length} points but the query ` +
        `returned ${queriedValues.length} — points were dropped or injected`,
      confidence: 'high',
    });
  }

  // Mixed currency across the rendered series (incommensurable bars).
  const renderedCurrencies = new Set(
    renderedValues
      .map((p) => p.currencyCode)
      .filter((c): c is string => typeof c === 'string' && c.length > 0),
  );
  if (renderedCurrencies.size > 1) {
    findings.push({
      kind: 'chart-truth.mixed-currency',
      path: 'chart.series',
      detail:
        `rendered series mixes currencies [${[...renderedCurrencies].join(', ')}] ` +
        `— bars are not commensurable`,
      confidence: 'high',
    });
  }

  // Mixed unit across the rendered series (kg vs tonnes plotted together).
  const renderedUnits = new Set(
    renderedValues
      .map((p) => p.unit)
      .filter((u): u is string => typeof u === 'string' && u.length > 0),
  );
  if (renderedUnits.size > 1) {
    findings.push({
      kind: 'chart-truth.unit-confusion',
      path: 'chart.series',
      detail:
        `rendered series mixes units [${[...renderedUnits].join(', ')}] — ` +
        `magnitudes are not directly comparable`,
      confidence: 'high',
    });
  }

  // Per-point comparison up to the shorter length.
  const n = Math.min(renderedValues.length, queriedValues.length);
  for (let i = 0; i < n; i += 1) {
    const r = renderedValues[i];
    const q = queriedValues[i];

    const rv = typeof r.value === 'number' ? r.value : Number.NaN;
    const qv = typeof q.value === 'number' ? q.value : Number.NaN;

    if (Number.isNaN(rv) || Number.isNaN(qv)) {
      findings.push({
        kind: 'chart-truth.value-divergence',
        path: `chart.series[${i}]`,
        detail: `point ${i} has a non-numeric value — cannot verify magnitude`,
        confidence: 'low',
      });
      continue;
    }

    const bound = tolerance * Math.max(1, Math.abs(qv));
    if (Math.abs(rv - qv) > bound) {
      findings.push({
        kind: 'chart-truth.value-divergence',
        path: `chart.series[${i}]`,
        detail:
          `point ${i} rendered ${rv} but the query returned ${qv} ` +
          `(beyond tolerance ${tolerance}) — the chart overstates the data`,
        confidence: 'high',
      });
    }

    // Per-point currency disagreement (a converted-but-mislabeled bar).
    if (
      r.currencyCode &&
      q.currencyCode &&
      r.currencyCode !== q.currencyCode
    ) {
      findings.push({
        kind: 'chart-truth.mixed-currency',
        path: `chart.series[${i}]`,
        detail:
          `point ${i} rendered in ${r.currencyCode} but the query returned ` +
          `${q.currencyCode} — currency relabeled without conversion`,
        confidence: 'high',
      });
    }

    // Per-point unit disagreement (a kg value drawn as tonnes).
    if (r.unit && q.unit && r.unit !== q.unit) {
      findings.push({
        kind: 'chart-truth.unit-confusion',
        path: `chart.series[${i}]`,
        detail:
          `point ${i} rendered as '${r.unit}' but the query returned ` +
          `'${q.unit}' — unit confusion`,
        confidence: 'high',
      });
    }
  }

  return { ok: findings.length === 0, findings: Object.freeze(findings) };
}
