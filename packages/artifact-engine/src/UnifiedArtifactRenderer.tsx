'use client';

/**
 * `UnifiedArtifactRenderer` — the ONE renderer.
 *
 * Generalizes `@borjie/genui`'s `AdaptiveRenderer` into a component that
 * takes an `ArtifactSpec` + a `HostContext`. It does NOT fork the 35
 * primitive renderers — it WRAPS `AdaptiveRenderer`, which already owns the
 * canonical dispatch:
 *
 *   - H10 defense-in-depth: re-`safeParse` against `PART_SCHEMAS[kind]`
 *     before the switch;
 *   - H11 telemetry: a `genui:unknown-kind` CustomEvent + `onUnknownKind`
 *     callback on the fallback path;
 *   - `UnknownKindCard` for any unknown / malformed kind.
 *
 * What this renderer ADDS on top:
 *
 *   (a) accepts an `ArtifactSpec` directly and PROJECTS it down to the flat
 *       `AgUiUiPart` shape the switch dispatches on (kind + payload from
 *       `config`) — so a spec renders without re-authoring;
 *   (b) injects `HostContext` (theme / locale / density / formatCurrency /
 *       the action membrane) via a context provider primitives can read;
 *   (c) resolves `spec.binding` via the injected `WidgetDataPort`
 *       (interface only in this wave — a host without one renders the
 *       static `config` seed);
 *   (d) mounts the ONE `ActionButton` (the single action component:
 *       known verb → handler / unknown verb → `deferToBrain`);
 *   (e) is reachability-complete: an UNKNOWN `kind` (one `PART_SCHEMAS`
 *       does not know) renders `UnknownKindCard` — never throws, never
 *       needs a new hardcoded branch.
 *
 * The `surface` chrome (inline / blackboard / tab / dashboard / document)
 * is chosen upstream by `routeArtifact` and threaded through `host.surface`
 * — it selects CHROME ONLY; the dispatch + validation + data + actions are
 * identical on every surface. This wave wraps the body in a single
 * surface-tagged container; richer per-surface chrome lands in a later wave.
 */

import { createContext, useContext } from 'react';
import {
  AdaptiveRenderer,
  UnknownKindCard,
  PART_SCHEMAS,
} from '@borjie/genui';
import type { ArtifactSpec } from './spec.js';
import { isKnownArtifactKind } from './spec.js';
import type { HostContext, ArtifactAction } from './host-context.js';
import { ActionButton } from './ActionButton.js';

// ---------------------------------------------------------------------------
// 1. HostContext provider — primitives read host wiring without prop-drilling.
// ---------------------------------------------------------------------------

const HostContextCtx = createContext<HostContext | null>(null);

/**
 * Read the injected `HostContext`. Throws a CLEAR error when used outside a
 * `UnifiedArtifactRenderer` so a mis-mounted primitive fails loud in dev
 * rather than silently rendering with no host wiring.
 */
export function useHostContext(): HostContext {
  const ctx = useContext(HostContextCtx);
  if (!ctx) {
    throw new Error(
      'useHostContext must be used within a <UnifiedArtifactRenderer> (HostContext was not injected)',
    );
  }
  return ctx;
}

/** Non-throwing variant for primitives that can render host-agnostic. */
export function useOptionalHostContext(): HostContext | null {
  return useContext(HostContextCtx);
}

// ---------------------------------------------------------------------------
// 2. Spec → AgUiUiPart projection.
// ---------------------------------------------------------------------------

/**
 * Project an `ArtifactSpec` down to the flat part shape the
 * `AdaptiveRenderer` switch dispatches on: `{ kind, ...config }`. The spec
 * carries its primitive props in `config` (the VegaLite spec / rows /
 * tiles / …); flattening them next to the `kind` reproduces the exact
 * `AgUiUiPart` the switch + `PART_SCHEMAS[kind]` re-validation expect.
 *
 * Pure — never mutates the spec.
 */
function projectSpecToPart(spec: ArtifactSpec): Record<string, unknown> {
  const config = spec.config ?? {};
  return { kind: spec.kind, ...config };
}

// ---------------------------------------------------------------------------
// 3. Surface chrome — a thin tagged container (rich chrome is a later wave).
// ---------------------------------------------------------------------------

function surfaceClassName(): string {
  // CHROME ONLY — dispatch/validation/data/actions are identical across
  // surfaces. We tag the container with data-attrs (below) so a host
  // stylesheet (and a later-wave chrome layer) can style per
  // surface/density/theme without this package owning any visual design.
  return 'borjie-artifact';
}

// ---------------------------------------------------------------------------
// 4. The renderer.
// ---------------------------------------------------------------------------

export interface UnifiedArtifactRendererProps {
  readonly spec: ArtifactSpec;
  readonly host: HostContext;
  /**
   * Optional host-localised status copy threaded to every `ActionButton`
   * (so action buttons never hard-code a locale string).
   */
  readonly actionStatusLabels?: Parameters<typeof ActionButton>[0]['statusLabels'];
}

export function UnifiedArtifactRenderer({
  spec,
  host,
  actionStatusLabels,
}: UnifiedArtifactRendererProps): JSX.Element {
  const known = isKnownArtifactKind(spec.kind) && spec.kind in PART_SCHEMAS;

  return (
    <HostContextCtx.Provider value={host}>
      <div
        className={surfaceClassName()}
        data-artifact-id={spec.artifactId}
        data-artifact-kind={spec.kind}
        data-artifact-surface={host.surface}
        data-artifact-density={host.density}
        data-artifact-theme={host.theme}
        data-artifact-locale={host.locale}
        data-artifact-lifecycle={spec.lifecycle}
      >
        {known ? (
          // Known kind → the SAME AdaptiveRenderer dispatch (re-validates
          // via PART_SCHEMAS[kind], renders one of the 35 primitives). We
          // do NOT fork the renderers — we wrap the canonical one.
          <AdaptiveRenderer
            uiPart={projectSpecToPart(spec) as never}
          />
        ) : (
          // Unknown kind → reachability-complete graceful degrade. Never
          // throws, never needs a new branch — the generativity guarantee.
          <UnknownKindCard kind={spec.kind} payload={spec} />
        )}

        {/* The ONE action membrane — known verb → handler / unknown →
            deferToBrain. Rendered from the spec-level actions (carried in
            config.actions when present), all through ActionButton. */}
        <ArtifactActions
          spec={spec}
          onAction={host.onAction}
          statusLabels={actionStatusLabels}
        />
      </div>
    </HostContextCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// 5. The action row — every action goes through the ONE ActionButton.
// ---------------------------------------------------------------------------

/**
 * Read the spec's actions. An `ArtifactSpec` carries its action intents in
 * the TOP-LEVEL `actions` array (NOT in `config` — `config` is the strict
 * primitive payload re-validated against `PART_SCHEMAS[kind]`). We narrow
 * defensively — a malformed actions array yields zero buttons rather than
 * throwing, so an unparsed wire spec degrades gracefully.
 */
function readSpecActions(spec: ArtifactSpec): ReadonlyArray<ArtifactAction> {
  const raw = (spec as { actions?: unknown }).actions;
  if (!Array.isArray(raw)) return [];
  const actions: ArtifactAction[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { id?: unknown }).id === 'string' &&
      typeof (item as { label?: unknown }).label === 'string' &&
      typeof (item as { verb?: unknown }).verb === 'string'
    ) {
      const a = item as {
        id: string;
        label: string;
        verb: string;
        params?: Record<string, unknown>;
      };
      actions.push({
        id: a.id,
        label: a.label,
        verb: a.verb,
        ...(a.params ? { params: a.params } : {}),
      });
    }
  }
  return actions;
}

interface ArtifactActionsProps {
  readonly spec: ArtifactSpec;
  readonly onAction: HostContext['onAction'];
  readonly statusLabels?: Parameters<typeof ActionButton>[0]['statusLabels'];
}

function ArtifactActions({
  spec,
  onAction,
  statusLabels,
}: ArtifactActionsProps): JSX.Element | null {
  const actions = readSpecActions(spec);
  if (actions.length === 0) return null;
  return (
    <div className="borjie-artifact-actions" role="group">
      {actions.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          onAction={onAction}
          statusLabels={statusLabels}
        />
      ))}
    </div>
  );
}
