/**
 * The capability registry — re-exported from `@borjie/portal-genui`.
 *
 * The vetted, CLOSED vocabulary an artifact binding targets — 18 queryable
 * `PORTAL_QUERY_RESOURCES` + 6 `PORTAL_TOOL_IDS` + the `isKnownResource` /
 * `isKnownTool` parse-time guards — already lives in
 * `packages/portal-genui/src/capabilities/registry.ts`. This module
 * RE-EXPORTS it so an `@borjie/artifact-engine` consumer reaches the
 * registry without also importing the whole tab-generation package, and so
 * `ArtifactSpec` bindings are vetted against the SAME closed set the
 * tab-widget bindings are.
 *
 * ADDITIVE: this is a re-export shim, NOT a copy. The registry stays
 * single-sourced in portal-genui in this wave; physically MOVING it here
 * (with portal-genui re-importing) is a later-wave block. Re-exporting now
 * guarantees zero drift and zero new vocabulary.
 */

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
} from '@borjie/portal-genui';
