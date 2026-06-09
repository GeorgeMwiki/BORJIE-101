/**
 * Artifact-egress membrane — composition root (Wave 5 / OK-8a closure).
 *
 * The committed IP-egress firewall (`egress-filter-wiring.ts`) guards brain
 * TEXT — the streamed answer, tool args, error messages — before it reaches a
 * client. But the ARTIFACT path BYPASSES it: a `projectArtifactToUiPart` result
 * (`packages/genui/src/projector.ts`) and the Live re-query / modality-proposal
 * callback path emit a structured UI payload with NO egress projection at all.
 * A mechanic field — an agent name, a tool name, arbiter rationale, an internal
 * id, a chain-of-thought trace — riding inside an artifact's props/data/config
 * blob would sail straight past the text firewall to the client.
 *
 * This module closes that gap. It is the MANDATORY, FAIL-CLOSED last hop for
 * any STRUCTURED artifact reaching a client, mirroring the text firewall but
 * for the typed-payload path. It enforces the same hard invariant
 * (INV-H / INV-D): a client (chat / mobile / artifact frame / Live re-query)
 * sees ONLY a typed StatusSpan | Output | Evidence ALLOW-LIST projection —
 * NEVER agent names, tool names, arbiter rationale, internal ids, or
 * chain-of-thought.
 *
 * ALLOW-LIST, not deny-list: we do NOT enumerate forbidden fields and hope to
 * have caught them all. We start from `{}` and copy across ONLY the fields the
 * client legitimately renders:
 *   - renderable artifact content (the typed UiPart's own render fields, or a
 *     PortalTab's title / description / sections / widgets);
 *   - `evidence_ids` (the Evidence channel — every junior recommendation cites
 *     ≥1 evidence id; the client renders provenance chips from these);
 *   - `status` (the StatusSpan channel — phase / done / failed).
 * EVERYTHING ELSE is omitted by construction. A field the membrane has never
 * heard of cannot leak because it is never copied in.
 *
 * A second, defensive scrub runs over the free-form blobs that the allow-list
 * unavoidably forwards verbatim (a chart's `data` rows, a forecast `artifact`
 * descriptor, a PortalTab widget `config`): any OBJECT KEY that names a known
 * mechanic concept (agent / tool / arbiter / rationale / chain-of-thought /
 * internal id / cognition) is dropped at every depth. This is belt-and-braces:
 * the allow-list already excludes the structural mechanic fields; the key-scrub
 * catches a mechanic field smuggled INSIDE an otherwise-renderable blob.
 *
 * FAIL-CLOSED: a projection that throws (or any internal fault) NEVER falls
 * through to raw passthrough. On any error we emit a SAFE MINIMAL artifact
 * (`notification-toast` carrying a generic "content unavailable" message),
 * never the raw payload — exactly as the text firewall fails closed to
 * `[redacted]` (CLAUDE.md: "Kill-switch fail-closed. Never catch + ignore its
 * errors.").
 *
 * DOMPurify is UNCHANGED and STILL REQUIRED on the client render side (markdown
 * / SVG / HTML in `markdown-card`, `code-block`, etc. is sanitised at render in
 * `packages/chat-ui` / owner-web `ArtifactRenderer`). This membrane is a
 * STRUCTURAL projection — it decides WHICH fields cross the wire, not how HTML
 * inside an allowed field is sanitised. The two layers compose.
 *
 * No `console.*` (Pino shim only). No `process.env` read — the membrane is a
 * pure projection with no kill-switch (a SECURITY FLOOR is not opt-out-able;
 * unlike the text firewall there is no legitimate operator reason to disable
 * the artifact membrane).
 *
 * @module services/api-gateway/src/composition/artifact-egress-wiring
 */

import type { AgUiUiPart } from '@borjie/genui/server';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ---------------------------------------------------------------------------
// Forbidden mechanic-field key vocabulary — the defensive key-scrub anchor.
// ---------------------------------------------------------------------------
//
// These are SUBSTRING markers matched (case-insensitively) against OBJECT KEY
// names inside free-form blobs the allow-list forwards verbatim. A key whose
// NAME contains any of these is a mechanic field — internal cognition that a
// client must never see — and is dropped at every depth. This is intentionally
// conservative + name-based: the markers name internal-platform concepts that
// never legitimately title a renderable artifact field. We do NOT scrub VALUES
// (a chart cell value, a metric, a date) — only KEYS whose name betrays a
// mechanic payload.

const FORBIDDEN_KEY_MARKERS: ReadonlyArray<string> = Object.freeze([
  'agentname',
  'agent_name',
  'agentid',
  'agent_id',
  'toolname',
  'tool_name',
  'toolcall',
  'tool_call',
  'arbiter',
  'rationale',
  'chainofthought',
  'chain_of_thought',
  'cot',
  'reasoning',
  'reasoningtrace',
  'reasoning_trace',
  'thought',
  'scratchpad',
  'internalid',
  'internal_id',
  'cognition',
  'debate',
  'critique',
  'systemprompt',
  'system_prompt',
  'persona',
  'promptid',
  'prompt_id',
  'mechanic',
  'sourceconversationid',
  'source_conversation_id',
  'audittrail',
  'audit_trail',
]);

/** Max recursion depth for the defensive key-scrub (DoS guard). */
const MAX_SCRUB_DEPTH = 12;

/**
 * The single safe-minimal artifact emitted on a fail-closed event. A
 * `notification-toast` is the most innocuous renderable kind — it carries no
 * data blob, only a generic message, so it can never itself leak. Frozen +
 * cloned per emit so a caller cannot mutate the shared instance.
 */
const FAIL_CLOSED_MESSAGE = 'Content unavailable.';

function failClosedArtifact(): AgUiUiPart {
  return {
    kind: 'notification-toast',
    message: FAIL_CLOSED_MESSAGE,
    severity: 'info',
  };
}

/**
 * Does this object-key name a mechanic concept? Case-insensitive,
 * separator-insensitive substring match against the forbidden vocabulary.
 */
function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const marker of FORBIDDEN_KEY_MARKERS) {
    if (normalized.includes(marker.replace(/[^a-z0-9]/g, ''))) return true;
  }
  return false;
}

/**
 * Recursively copy a JSON-ish value, DROPPING every object key whose name
 * matches the forbidden mechanic vocabulary. Pure — returns a NEW structure,
 * never mutates the input (immutability). Arrays are mapped; primitives pass
 * through. Beyond `MAX_SCRUB_DEPTH` we drop to a primitive-safe coercion so a
 * pathological nesting can never blow the stack.
 */
function scrubMechanicKeys(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_SCRUB_DEPTH) {
    // Too deep — return a shallow primitive marker instead of recursing.
    return Array.isArray(value) ? [] : {};
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubMechanicKeys(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(k)) continue;
    out[k] = scrubMechanicKeys(v, depth + 1);
  }
  return out;
}

/**
 * Coerce an unknown value to a string[] of evidence ids (the Evidence channel).
 * Non-string entries are dropped. Always returns a NEW frozen array.
 */
function toEvidenceIds(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
}

// ---------------------------------------------------------------------------
// AgUiUiPart projection — per-kind renderable allow-list.
// ---------------------------------------------------------------------------
//
// Each branch starts from the kind discriminator and copies across ONLY the
// renderable fields of that kind. The free-form data carriers (`data`, `rows`,
// `cells`, `config`, …) are additionally run through `scrubMechanicKeys` so a
// mechanic field smuggled INSIDE a data row cannot ride along. Anything not
// listed for a kind is omitted by construction.

type AnyPart = Record<string, unknown> & { kind?: unknown };

/** Copy `title` when present (every kind allows an optional title). */
function withTitle(src: AnyPart, out: Record<string, unknown>): void {
  if (typeof src.title === 'string') out.title = src.title;
}

/**
 * Project ONE `AgUiUiPart` to its renderable allow-list. Returns a NEW part —
 * never mutates the input. Throws on a structurally invalid input (no `kind`);
 * the caller's try/catch turns that into a fail-closed artifact.
 */
function projectUiPart(part: AgUiUiPart): AgUiUiPart {
  const src = part as AnyPart;
  const kind = src.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('artifact-egress: ui-part has no kind discriminator');
  }
  const out: Record<string, unknown> = { kind };
  withTitle(src, out);

  switch (kind) {
    case 'chart-vega': {
      // spec is a vega-lite render spec (declarative, no cognition); data rows
      // are tenant business data — scrub keys defensively.
      if (src.spec && typeof src.spec === 'object') out.spec = scrubMechanicKeys(src.spec);
      out.data = scrubMechanicKeys(Array.isArray(src.data) ? src.data : []);
      break;
    }
    case 'data-table': {
      out.columns = scrubMechanicKeys(Array.isArray(src.columns) ? src.columns : []);
      out.rows = scrubMechanicKeys(Array.isArray(src.rows) ? src.rows : []);
      if (typeof src.pageSize === 'number') out.pageSize = src.pageSize;
      break;
    }
    case 'kpi-grid': {
      out.tiles = scrubMechanicKeys(Array.isArray(src.tiles) ? src.tiles : []);
      break;
    }
    case 'timeline': {
      out.events = scrubMechanicKeys(Array.isArray(src.events) ? src.events : []);
      break;
    }
    case 'workflow': {
      out.steps = scrubMechanicKeys(Array.isArray(src.steps) ? src.steps : []);
      out.currentIndex = typeof src.currentIndex === 'number' ? src.currentIndex : 0;
      break;
    }
    case 'markdown-card': {
      // markdown is sanitised by DOMPurify at render — we keep the field but it
      // is NOT raw HTML egress here (structural projection only).
      out.markdown = typeof src.markdown === 'string' ? src.markdown : '';
      if (Array.isArray(src.citations)) out.citations = scrubMechanicKeys(src.citations);
      if (typeof src.severity === 'string') out.severity = src.severity;
      break;
    }
    case 'code-block': {
      out.code = typeof src.code === 'string' ? src.code : '';
      out.language = typeof src.language === 'string' ? src.language : 'text';
      if (typeof src.filename === 'string') out.filename = src.filename;
      if (Array.isArray(src.highlightLines)) out.highlightLines = src.highlightLines;
      break;
    }
    case 'media-grid': {
      out.items = scrubMechanicKeys(Array.isArray(src.items) ? src.items : []);
      if (typeof src.columns === 'number') out.columns = src.columns;
      break;
    }
    case 'heatmap': {
      out.xAxis = Array.isArray(src.xAxis) ? src.xAxis : [];
      out.yAxis = Array.isArray(src.yAxis) ? src.yAxis : [];
      // Cells can be arbitrary cell objects — a hostile/buggy producer could
      // smuggle a mechanic key inside one, so scrub at every depth (allow-list,
      // never trust the producer payload). Mirrors the chart-vega/data-table branches.
      out.cells = scrubMechanicKeys(Array.isArray(src.cells) ? src.cells : []);
      out.colorScale = typeof src.colorScale === 'string' ? src.colorScale : 'linear';
      out.format = typeof src.format === 'string' ? src.format : 'count';
      for (const k of ['minValue', 'maxValue', 'currency', 'unit'] as const) {
        if (src[k] !== undefined) out[k] = src[k];
      }
      break;
    }
    case 'evidence-card': {
      // The Evidence channel — explicitly allowed. quote + source provenance.
      out.quote = typeof src.quote === 'string' ? src.quote : '';
      out.sourceTitle = typeof src.sourceTitle === 'string' ? src.sourceTitle : '';
      for (const k of ['sourceUri', 'sourcePageOrLocator', 'confidence', 'extractedAt'] as const) {
        if (typeof src[k] === 'string') out[k] = src[k];
      }
      break;
    }
    case 'comparison-table': {
      out.columns = Array.isArray(src.columns) ? src.columns : [];
      out.rows = scrubMechanicKeys(Array.isArray(src.rows) ? src.rows : []);
      break;
    }
    case 'org-chart': {
      out.root = scrubMechanicKeys(src.root ?? {});
      if (typeof src.orientation === 'string') out.orientation = src.orientation;
      break;
    }
    case 'gauge': {
      for (const k of ['value', 'min', 'max'] as const) {
        out[k] = typeof src[k] === 'number' ? src[k] : 0;
      }
      out.label = typeof src.label === 'string' ? src.label : '';
      if (typeof src.format === 'string') out.format = src.format;
      if (typeof src.currency === 'string') out.currency = src.currency;
      if (Array.isArray(src.thresholds)) out.thresholds = src.thresholds;
      break;
    }
    case 'metric-sparkline': {
      out.label = typeof src.label === 'string' ? src.label : '';
      out.value = typeof src.value === 'number' ? src.value : 0;
      out.format = typeof src.format === 'string' ? src.format : 'number';
      out.sparkline = Array.isArray(src.sparkline) ? src.sparkline : [];
      for (const k of ['currency', 'delta', 'deltaIsPositive'] as const) {
        if (src[k] !== undefined) out[k] = src[k];
      }
      break;
    }
    case 'map': {
      out.center = Array.isArray(src.center) ? src.center : [0, 0];
      out.zoom = typeof src.zoom === 'number' ? src.zoom : 10;
      out.markers = scrubMechanicKeys(Array.isArray(src.markers) ? src.markers : []);
      break;
    }
    case 'notification-toast': {
      out.message = typeof src.message === 'string' ? src.message : '';
      out.severity = typeof src.severity === 'string' ? src.severity : 'info';
      if (typeof src.autoCloseMs === 'number') out.autoCloseMs = src.autoCloseMs;
      // actionLabel + actionPayload are interaction wiring — keep label only;
      // payload is scrubbed (could carry a tool/agent handle).
      if (typeof src.actionLabel === 'string') out.actionLabel = src.actionLabel;
      if (src.actionPayload !== undefined) out.actionPayload = scrubMechanicKeys(src.actionPayload);
      break;
    }
    case 'decision-trace': {
      // A decision-trace's STEP `rationale` is internal arbiter reasoning =
      // chain-of-thought. The membrane keeps the renderable scaffold (title,
      // summary, step title + kind + evidence + confidence) but DROPS every
      // step's `rationale` — exactly the field the invariant forbids.
      if (typeof src.summary === 'string') out.summary = src.summary;
      const steps = Array.isArray(src.steps) ? src.steps : [];
      out.steps = steps.map((rawStep) => {
        const step = (rawStep ?? {}) as Record<string, unknown>;
        const safeStep: Record<string, unknown> = {};
        if (typeof step.id === 'string') safeStep.id = step.id;
        if (typeof step.title === 'string') safeStep.title = step.title;
        if (typeof step.kind === 'string') safeStep.kind = step.kind;
        if (typeof step.confidence === 'string') safeStep.confidence = step.confidence;
        if (Array.isArray(step.evidence)) safeStep.evidence = scrubMechanicKeys(step.evidence);
        // step.rationale DELIBERATELY OMITTED — chain-of-thought.
        return safeStep;
      });
      break;
    }
    default: {
      // For every other vetted kind, forward the part's own fields through the
      // defensive key-scrub. The kind set is closed + vetted (no field on any
      // AgUiUiPart names a mechanic concept), so the structural shape is safe;
      // the key-scrub still drops any mechanic key smuggled into a nested blob.
      const scrubbed = scrubMechanicKeys(src) as Record<string, unknown>;
      return scrubbed as unknown as AgUiUiPart;
    }
  }

  return out as unknown as AgUiUiPart;
}

// ---------------------------------------------------------------------------
// Public membrane surface.
// ---------------------------------------------------------------------------

/**
 * The projected, client-safe envelope for a modality / Live re-query artifact.
 * Only the three allow-listed channels reach the client:
 *   - `artifact`  — the renderable UiPart / descriptor (mechanic keys scrubbed)
 *   - `evidenceIds` — the Evidence channel
 *   - `status`    — the StatusSpan channel (a small, render-safe string)
 * Plus the renderable `tab` preview (title / description / sections / widgets),
 * stripped of its mechanic `audit` block.
 */
export interface ProjectedArtifactEnvelope {
  readonly artifact: unknown;
  readonly tab: unknown;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly status: string | null;
}

/**
 * Project a PortalTab-shaped preview to its renderable allow-list. Keeps
 * title / description / icon / domain / sections / widgets (the render frame);
 * DROPS `audit` (actorId / sourceConversationId / history — mechanic
 * provenance), `permissions` internals beyond the persona list, and any nested
 * mechanic key. Returns `null` when the input is not an object.
 */
function projectTabPreview(tab: unknown): unknown {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null;
  const src = tab as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'tabKey', 'title', 'description', 'icon', 'domain'] as const) {
    if (typeof src[k] === 'string') out[k] = src[k];
  }
  if (Array.isArray(src.sections)) out.sections = scrubMechanicKeys(src.sections);
  // audit, permissions, createdAt/updatedAt, userId, version DELIBERATELY
  // OMITTED — provenance / mechanic header fields, never client-renderable.
  return out;
}

export interface ArtifactEgressMembrane {
  /**
   * Project ONE typed `AgUiUiPart` (the `projectArtifactToUiPart` result) to
   * its client-safe renderable allow-list. FAIL-CLOSED: returns the
   * safe-minimal artifact on any fault, never the raw part.
   */
  readonly guardUiPart: (part: AgUiUiPart) => AgUiUiPart;
  /**
   * Project a modality / Live re-query envelope (`{ artifact, tab, evidenceIds,
   * status }`) to the allow-listed channels. FAIL-CLOSED: returns an envelope
   * whose `artifact` is the safe-minimal artifact on any fault.
   */
  readonly guardEnvelope: (input: {
    readonly artifact?: unknown;
    readonly tab?: unknown;
    readonly evidenceIds?: unknown;
    readonly status?: unknown;
  }) => ProjectedArtifactEnvelope;
}

/**
 * Build the artifact-egress membrane. Pure + dependency-light: there is no
 * kill-switch (a security floor is not opt-out-able) and no per-request env
 * read. The only injected dependency is the logger for the fail-closed WARN.
 */
export function createArtifactEgressMembrane(
  logger: PinoLikeLogger = createPinoLikeLogger('artifact-egress'),
): ArtifactEgressMembrane {
  return Object.freeze({
    guardUiPart(part: AgUiUiPart): AgUiUiPart {
      try {
        return projectUiPart(part);
      } catch (err) {
        logger.error(
          {
            wiring: 'artifact-egress',
            err: err instanceof Error ? err.message : String(err),
          },
          'artifact-egress: ui-part projection FAILED — failing closed (safe-minimal artifact)',
        );
        return failClosedArtifact();
      }
    },

    guardEnvelope(input): ProjectedArtifactEnvelope {
      try {
        const status =
          typeof input.status === 'string' && input.status.length > 0
            ? input.status
            : null;
        const evidenceIds = toEvidenceIds(input.evidenceIds);
        const tab = projectTabPreview(input.tab);
        // The free-form artifact descriptor (forecast JSON / document refs /
        // media descriptor) is forwarded with mechanic keys scrubbed at every
        // depth. It is opaque renderable content — we never enumerate its
        // shape, but we DROP any mechanic key inside it by construction.
        const artifact =
          input.artifact === undefined || input.artifact === null
            ? null
            : scrubMechanicKeys(input.artifact);
        return Object.freeze({ artifact, tab, evidenceIds, status });
      } catch (err) {
        logger.error(
          {
            wiring: 'artifact-egress',
            err: err instanceof Error ? err.message : String(err),
          },
          'artifact-egress: envelope projection FAILED — failing closed (safe-minimal artifact)',
        );
        return Object.freeze({
          artifact: failClosedArtifact(),
          tab: null,
          evidenceIds: Object.freeze([]),
          status: null,
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Process singleton + test seam.
// ---------------------------------------------------------------------------

let cached: ArtifactEgressMembrane | null = null;
let override: ArtifactEgressMembrane | null = null;

/** Build (once) and return the process artifact-egress membrane. */
export function getArtifactEgressMembrane(
  logger?: PinoLikeLogger,
): ArtifactEgressMembrane {
  if (override) return override;
  if (cached) return cached;
  cached = createArtifactEgressMembrane(logger);
  return cached;
}

/** Test seam — inject a deterministic membrane (or reset to rebuild). */
export function __setArtifactEgressMembraneForTests(
  membrane: ArtifactEgressMembrane | null,
): void {
  override = membrane;
  cached = null;
}
