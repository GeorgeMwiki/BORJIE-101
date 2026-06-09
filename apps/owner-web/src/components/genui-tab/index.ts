/**
 * Public surface for the owner-web GenUI tab host — renders MD-authored
 * dynamic `PortalTab` documents via the existing @borjie/portal-genui
 * field/widget registries.
 */

export { GenUITabHost, type GenUITabHostProps } from './GenUITabHost';
export { GenUIFieldRenderer } from './GenUIFieldRenderer';
export { GenUIWidgetRenderer } from './GenUIWidgetRenderer';
export { useGenuiTab, type GenuiTabFetchState } from './use-genui-tab';
export {
  useArtifactResolver,
  type ArtifactResolveState,
  type ResolvedArtifact,
  type ArtifactDescriptorKind,
} from './use-artifact-resolver';
export {
  ArtifactProposalHost,
  type ArtifactProposalHostProps,
} from './ArtifactProposalHost';
export { toSafeText } from './sanitize';
