/**
 * Inline-Chat Data Presenter — public surface.
 *
 * The Managing Director "owner never leaves chat" promise. The
 * presenter turns natural-language owner asks into typed
 * `GenerativeUiSpec`s that the closed registry in
 * `@/core/brain/generative-ui` renders inline. Wire into the
 * command-chat SSE layer by calling `processOwnerTurn` per turn and
 * emitting the resulting spec via the `generative-ui` event.
 *
 * @module features/central-command/md/presenter
 */

export {
  processOwnerTurn,
  setPresenterTraceStore,
  getPresenterTraceStore,
  type ProcessResult,
} from "./presenter-service";

export {
  parseOwnerIntent,
  inferOwnerStyleHint,
  listIntentRules,
  type ParseInput,
} from "./intent-parser";

export {
  fetchInlineData,
  setSupabaseFactory,
  type SupabaseFactory,
} from "./data-fetcher";

export { buildPresenterSpec, tierToBadge } from "./spec-builder";
export type { SpecBuilderInput } from "./spec-builder";

export { tintForOwnerStyle } from "./owner-style-tinter";
export type { TintInput } from "./owner-style-tinter";

export { buildFilePreviewSpec } from "./file-preview";
export { buildOrgChartDiagram, type OrgChartNode } from "./diagram-builder";

export {
  InlineDataRequestSchema,
  InlineDataKindSchema,
  InlineDataSubjectSchema,
  OwnerStyleHintSchema,
  type InlineDataRequest,
  type InlineDataKind,
  type InlineDataSubject,
  type OwnerStyleHint,
  type InlineDataRow,
  type InlineDataFetchResult,
  type PresenterContext,
} from "./types";
