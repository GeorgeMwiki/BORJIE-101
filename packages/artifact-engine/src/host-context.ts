/**
 * `HostContext` + the action / data ports the `UnifiedArtifactRenderer`
 * injects per-host.
 *
 * The renderer is shared by construction across every surface (inline /
 * blackboard / tab / dashboard / document). It is the HOST — owner-web,
 * admin-web, a mobile shell, or a future external MCP host — that supplies
 * the live wiring: how a binding resolves to rows, how an action is
 * dispatched under the policy gate, how money is formatted in the active
 * locale. Those are PORTS (interfaces) here; the live implementations are
 * wired per-host in a LATER wave. This wave ships the seams only.
 *
 * Pure types — no React, no I/O.
 */

import type { PortalLocale, PortalTabWidgetBinding } from '@borjie/portal-genui';
import type { ArtifactSurface } from './route-artifact.js';

// ---------------------------------------------------------------------------
// 1. The action membrane — known verb → handler / unknown verb → brain.
// ---------------------------------------------------------------------------

/**
 * An action the owner can fire from an artifact. The brain MEDIATES every
 * action as an INTENT (the MCP-UI rule: a widget emits intents, never
 * mutates state directly). A `verb` names what to do; `params` carry the
 * payload. The host routes a KNOWN verb to a governed handler, and an
 * UNKNOWN verb to the generative `deferToBrain` seam — so a net-new verb
 * the brain invents is fulfilled under the policy gate + audit, never
 * dropped on a static allowlist.
 */
export interface ArtifactAction {
  /** Stable action id (unique within the artifact). */
  readonly id: string;
  /** Localised button label — authored by the brain in the active locale. */
  readonly label: string;
  /** The intent verb the host routes on (e.g. `create_reminder`). */
  readonly verb: string;
  /** Optional shallow param map carried to the handler / brain. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * The result of dispatching an action. The host's `onAction` resolves to
 * one of these; the `ActionButton` drives its state machine off the
 * `status`:
 *
 *   - `executed`     — a known verb ran to completion (terminal: done).
 *   - `deferToBrain` — an unknown / generative verb was handed to the
 *                      brain for fulfillment (transitional: handling).
 *   - `declined`     — the owner / policy gate declined (terminal).
 *   - `failed`       — the handler errored (terminal, retryable).
 */
export type ArtifactActionStatus =
  | 'executed'
  | 'deferToBrain'
  | 'declined'
  | 'failed';

export interface ArtifactActionResult {
  readonly status: ArtifactActionStatus;
  /** Optional human-readable message (localised by the host). */
  readonly message?: string;
}

/**
 * The host's action dispatcher. The renderer NEVER calls a tool directly —
 * it hands the intent to this port. The host is the authoritative security
 * boundary: it decides known-verb → governed handler vs unknown-verb →
 * `deferToBrain` (the `confirmAction` seam), keeping the money path through
 * `LedgerService.post()` and never letting a widget bypass RLS.
 */
export type ArtifactActionPort = (
  action: ArtifactAction,
) => Promise<ArtifactActionResult>;

// ---------------------------------------------------------------------------
// 2. The widget-data port — how a binding resolves to live rows.
// ---------------------------------------------------------------------------

/**
 * The result of resolving a binding to live data. `rows` for a `query`
 * binding; `ok` + optional `result` for a `tool` binding. Kept narrow +
 * serializable so the port can cross any transport.
 */
export interface WidgetDataResult {
  /** True when the resolve succeeded. */
  readonly ok: boolean;
  /** Resolved rows for a `query` binding. */
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  /** Opaque result payload for a `tool` binding. */
  readonly result?: Record<string, unknown>;
  /** Resolve error message (host-localised) when `ok === false`. */
  readonly error?: string;
  /**
   * ISO-8601 timestamp the data was resolved at. Lets a surface stamp
   * staleness — a board artifact MUST show live-or-stale, never a silent
   * snapshot (the blueprint's no-static-snapshot rule).
   */
  readonly resolvedAt?: string;
}

/**
 * The widget-data port. INTERFACE ONLY in this wave — the live resolver
 * (the generalized `/api/v1/artifacts/resolve-binding` endpoint) is wired
 * per-host in a later wave. A host that does not supply one renders the
 * artifact's static `config` seed only.
 */
export type WidgetDataPort = (
  binding: PortalTabWidgetBinding,
  ctx: { readonly artifactId: string },
) => Promise<WidgetDataResult>;

// ---------------------------------------------------------------------------
// 3. The HostContext — injected into the UnifiedArtifactRenderer.
// ---------------------------------------------------------------------------

/** Visual density the host renders at. */
export type ArtifactDensity = 'comfortable' | 'compact';

/** Theme the host renders at — light / dark / host-default. */
export type ArtifactTheme = 'light' | 'dark' | 'system';

/**
 * Everything the renderer needs from its host, injected as ONE object so
 * the renderer stays host-agnostic and the same component renders on every
 * surface. The blueprint's required shape, made concrete:
 *
 *   { surface, locale, density, theme, query?, onAction, formatCurrency }
 */
export interface HostContext {
  /** The surface chrome to render (chosen by `routeArtifact`). */
  readonly surface: ArtifactSurface;
  /**
   * The ACTIVE render locale. HOST-INJECTED, never widget-decided — the
   * absolute en/sw separation invariant. The renderer passes it to every
   * label-producing primitive; the brain authored the labels in this same
   * locale, so no EN/SW mixing can occur.
   */
  readonly locale: PortalLocale;
  /** Visual density. */
  readonly density: ArtifactDensity;
  /** Theme. */
  readonly theme: ArtifactTheme;
  /**
   * OPTIONAL live-data resolver port. Absent ⇒ render the static `config`
   * seed only (no live binding resolution). Wired per-host in a later wave.
   */
  readonly query?: WidgetDataPort;
  /**
   * The action membrane. Known verb → governed handler; unknown verb →
   * `deferToBrain`. Required — every host must decide how an intent is
   * mediated (the safest host returns `{ status: 'declined' }`).
   */
  readonly onAction: ArtifactActionPort;
  /**
   * Locale-aware money formatter. Injected (not imported) so the host
   * controls the locale binding and no money render hard-codes a currency.
   * Mirrors `@borjie/genui` `formatCurrency(amount, currencyCode)`.
   */
  readonly formatCurrency: (amount: number, currencyCode: string) => string;
}
