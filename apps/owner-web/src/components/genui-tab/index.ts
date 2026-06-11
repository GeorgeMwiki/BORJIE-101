/**
 * Public surface for the owner-web GenUI tab host — renders MD-authored
 * dynamic `PortalTab` documents via the existing @borjie/portal-genui
 * field/widget registries.
 */

export { GenUITabHost, type GenUITabHostProps } from './GenUITabHost';
export { GenUIFieldRenderer } from './GenUIFieldRenderer';
export { GenUIWidgetRenderer } from './GenUIWidgetRenderer';
export { GenUIRecordsList } from './GenUIRecordsList';
export { useGenuiTab, type GenuiTabFetchState } from './use-genui-tab';
export {
  useGenuiWidgetData,
  GenuiWidgetBindingSchema,
  GENUI_WIDGET_BINDING_KINDS,
  type GenuiWidgetBinding,
  type GenuiWidgetBindingKind,
  type GenuiWidgetData,
} from './use-genui-widget-data';
export {
  readGenuiTabExtras,
  widgetExtrasFor,
  GenuiActionSchema,
  type GenuiAction,
  type GenuiTabExtras,
  type GenuiWidgetExtras,
} from './genui-tab-extras';
export {
  GenUIFormContext,
  useGenuiFormField,
  type GenuiFieldValue,
  type GenuiFormContextValue,
} from './genui-form-context';
export {
  useGenuiFormState,
  type GenuiFormState,
  type GenuiSubmitStatus,
} from './use-genui-form-state';
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
