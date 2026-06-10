/**
 * `@borjie/artifact-engine` — the ONE unified artifact engine.
 *
 * The brain holds a SINGLE emit vocabulary — `ArtifactSpec` — and every
 * surface in the estate is a lens onto it. This package is the additive
 * FOUNDATION that composes the two existing layers:
 *
 *   - `@borjie/genui`        — the 35 low-level primitives + the
 *                              AdaptiveRenderer dispatch (the floor);
 *   - `@borjie/portal-genui` — the strict tab-widget schema + the closed
 *                              capability registry (the binding vocab).
 *
 * artifact-engine sits ABOVE both and ships five seams:
 *
 *   1. spec.ts                    — the ONE ArtifactSpec (PortalTabWidget
 *                                   promoted, 35-kind superset, +5 fields,
 *                                   addressable node tree).
 *   2. route-artifact.ts          — the pure five-signal surface router
 *                                   (default inline, bias-to-chat).
 *   3. UnifiedArtifactRenderer.tsx— the ONE renderer (wraps AdaptiveRenderer,
 *                                   injects HostContext, mounts ActionButton,
 *                                   UnknownKindCard on unknown kinds).
 *   4. ActionButton.tsx           — the ONE action membrane (known verb →
 *                                   handler / unknown verb → deferToBrain).
 *   5. capabilities.ts            — the closed binding vocab (re-export).
 *
 * ADDITIVE — NON-BREAKING. Nothing here rewires the legacy inline / board /
 * tab / dashboard renderers; real surfaces migrate onto this engine in
 * later waves.
 */

// ── 1. The ONE spec ──────────────────────────────────────────────────────
export {
  ARTIFACT_KIND_NAMES,
  ArtifactKindSchema,
  ArtifactSignalsSchema,
  ARTIFACT_SIGNAL_KEYS,
  ArtifactLifecycleSchema,
  ARTIFACT_LIFECYCLES,
  ArtifactActionSpecSchema,
  ArtifactNodeSchema,
  ArtifactSpecSchema,
  parseArtifactSpec,
  safeParseArtifactSpec,
  isKnownArtifactKind,
  type ArtifactKindName,
  type ArtifactSignals,
  type ArtifactSignalKey,
  type ArtifactLifecycle,
  type ArtifactActionSpec,
  type ArtifactNode,
  type ArtifactNodeShape,
  type ArtifactSpec,
} from './spec.js';

// ── 2. The pure router ───────────────────────────────────────────────────
export {
  ARTIFACT_SURFACES,
  DOCUMENT_CLASS_KINDS,
  routeArtifact,
  type ArtifactSurface,
  type ArtifactRouteContext,
  type ArtifactRouteDecision,
} from './route-artifact.js';

// ── 3. Host context + the ports the renderer injects ─────────────────────
export type {
  HostContext,
  ArtifactAction,
  ArtifactActionPort,
  ArtifactActionResult,
  ArtifactActionStatus,
  WidgetDataPort,
  WidgetDataResult,
  ArtifactDensity,
  ArtifactTheme,
} from './host-context.js';

// ── 4. The ONE renderer + the ONE action button ──────────────────────────
export {
  UnifiedArtifactRenderer,
  useHostContext,
  useOptionalHostContext,
  type UnifiedArtifactRendererProps,
} from './UnifiedArtifactRenderer.js';

export {
  ActionButton,
  type ActionButtonProps,
  type ActionButtonState,
  type ActionButtonStatusLabels,
} from './ActionButton.js';

// ── 5. The closed binding vocabulary (capability registry re-export) ──────
export {
  PORTAL_QUERY_RESOURCES,
  PORTAL_QUERY_RESOURCE_LABELS,
  PORTAL_TOOL_IDS,
  PORTAL_TOOL_LABELS,
  isKnownResource,
  isKnownTool,
  getResourceLabel,
  getToolLabel,
  type PortalQueryResource,
  type PortalToolId,
} from './capabilities.js';
