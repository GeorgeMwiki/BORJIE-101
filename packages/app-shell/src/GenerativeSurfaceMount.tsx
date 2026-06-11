'use client';

import * as React from 'react';
import {
  SandboxedSurfaceFrame,
  type SandboxedSurface,
} from '@borjie/genui';
import {
  applyTabPatch,
  type PortalTab,
  type PortalTabPatch,
  type ApplyTabPatchOptions,
} from '@borjie/portal-genui';

/**
 * GenerativeSurfaceMount — the suite-wide seam that mounts an MD-authored
 * generative surface anywhere the shell renders (owner-web + admin-web).
 *
 * The MD "redesigns its own body" through two complementary lanes:
 *
 *   1. portal-tab — a `PortalTab` document of vetted fields + widgets, edited
 *      INCREMENTALLY via A2UI-style patches (add-column / move-section /
 *      update-field) WITHOUT a full re-render. The actual tab body is rendered
 *      by the consuming app's host (owner-web's `GenUITabHost`) which owns the
 *      field/widget registries; app-shell stays decoupled from those React
 *      components by taking a `renderTab` callback. This keeps app-shell
 *      lightweight and locale-pure while remaining the integration point.
 *
 *   2. sandboxed — a CSP-isolated iframe (`SandboxedSurface`) for genuinely
 *      novel surfaces the catalogs can't express. Rendered directly via the
 *      `@borjie/genui` `SandboxedSurfaceFrame` (sandbox + csp hardened).
 *
 * Live editing: when a `patch` is supplied for the portal-tab lane, the mount
 * applies it immutably through the shared `applyTabPatch` reducer and renders
 * the PATCHED tab — this is the "edit a live surface without a full
 * re-render of the document" path. On a patch failure the mount renders the
 * pre-patch tab and surfaces the reason via `onPatchError` (no crash).
 *
 * Locale policy: like the rest of app-shell, this component hard-codes NO
 * Swahili. All visible copy is owned by the rendered surface / the consumer's
 * `renderTab`; the mount itself renders only structural wrappers.
 */

// ── Surface descriptors (discriminated by `kind`) ───────────────────────────

export interface PortalTabSurfaceDescriptor {
  readonly kind: 'portal-tab';
  /** The current persisted tab. */
  readonly tab: PortalTab;
  /**
   * Optional incremental patch to apply before render — the MD's live edit.
   * Applied through the shared reducer; the patched tab is what `renderTab`
   * receives. Omit to render the tab as-is.
   */
  readonly patch?: PortalTabPatch;
  /** Audit/clock options forwarded to the patch reducer. Required when patching. */
  readonly patchOptions?: ApplyTabPatchOptions;
}

export interface SandboxedSurfaceDescriptor {
  readonly kind: 'sandboxed';
  readonly surface: SandboxedSurface;
  /** Forwarded to the frame — host handler for vetted-origin postMessages. */
  readonly onMessage?: (data: unknown, origin: string) => void;
}

export type GenerativeSurfaceDescriptor =
  | PortalTabSurfaceDescriptor
  | SandboxedSurfaceDescriptor;

export interface GenerativeSurfaceMountProps {
  readonly surface: GenerativeSurfaceDescriptor;
  /**
   * Renders the (possibly patched) PortalTab body. Required for the
   * portal-tab lane; the consumer passes owner-web's `GenUITabHost`-backed
   * renderer here. Ignored for the sandboxed lane.
   */
  readonly renderTab?: (tab: PortalTab) => React.ReactNode;
  /** Reported when a supplied patch fails to apply. */
  readonly onPatchError?: (reason: string, message: string) => void;
  /** Optional extra class on the wrapper. */
  readonly className?: string;
}

export const GenerativeSurfaceMount: React.FC<GenerativeSurfaceMountProps> = ({
  surface,
  renderTab,
  onPatchError,
  className,
}) => {
  const rootClassName = ['borjie-generative-surface-mount', className]
    .filter(Boolean)
    .join(' ');

  if (surface.kind === 'sandboxed') {
    return (
      <div className={rootClassName} data-surface-kind="sandboxed">
        <SandboxedSurfaceFrame
          surface={surface.surface}
          {...(surface.onMessage ? { onMessage: surface.onMessage } : {})}
        />
      </div>
    );
  }

  // portal-tab lane — apply the incremental patch (if any) immutably.
  let effectiveTab: PortalTab = surface.tab;
  if (surface.patch && surface.patchOptions) {
    const result = applyTabPatch(surface.tab, surface.patch, surface.patchOptions);
    if (result.ok) {
      effectiveTab = result.tab;
    } else if (onPatchError) {
      onPatchError(result.reason, result.message);
    }
  }

  return (
    <div
      className={rootClassName}
      data-surface-kind="portal-tab"
      data-tab-key={effectiveTab.tabKey}
    >
      {renderTab ? renderTab(effectiveTab) : null}
    </div>
  );
};

GenerativeSurfaceMount.displayName = 'GenerativeSurfaceMount';
