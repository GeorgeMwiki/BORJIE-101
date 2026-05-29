/**
 * `@borjie/owner-os-tabs` — public surface.
 *
 * Wave OWNER-OS-DYNAMIC. Contract package that lets ANY domain
 * (HR, Ops, Finance, Risk, Compliance, Workforce, Procurement, Audit,
 * Legal, ESG, Geology, Treasury, Marketplace, Licences, anything) register
 * itself as a spawnable tab in the owner cockpit.
 *
 * Zero React deps — the consuming app maps `rendererId` to a component.
 *
 * Modules:
 *   - types            schemas + descriptor contract
 *   - registry         registerTab / getTab / listTabs / buildTabId
 *   - intent-matcher   matchIntent / topIntent (deterministic, no LLM)
 *   - spawn-extractor  parse <spawn_tabs> tag from brain replies
 */

export {
  OWNER_OS_TAB_TYPES,
  ownerOsTabTypeSchema,
  ownerOsTabContextSchema,
  ownerOsSpawnIntentSchema,
  ownerOsSpawnBatchSchema,
  ownerOsPersistedTabSchema,
  ownerOsTabsStateSchema,
  type OwnerOSBriefSlice,
  type OwnerOSIntentMatchers,
  type OwnerOSPersistedTab,
  type OwnerOSSpawnBatch,
  type OwnerOSSpawnIntent,
  type OwnerOSTabColor,
  type OwnerOSTabContext,
  type OwnerOSTabDescriptor,
  type OwnerOSTabIndicator,
  type OwnerOSTabsState,
  type OwnerOSTabType,
  type OwnerOSToolSuggestion,
} from './types.js';

export {
  registerTab,
  getTab,
  listTabs,
  listSpawnableTabs,
  defaultTabId,
  buildTabId,
  validateContext,
  __resetRegistryForTests,
} from './registry.js';

export {
  matchIntent,
  topIntent,
  type IntentMatch,
  type IntentMatchInput,
} from './intent-matcher.js';

export {
  extractSpawnTabs,
  type ExtractSpawnResult,
} from './spawn-extractor.js';

export {
  DATA_CAPTURE_FIELD_KINDS,
  INLINE_BLOCK_TYPES,
  dataCaptureCardSchema,
  confirmationCardSchema,
  fileRequestCardSchema,
  microActionCardSchema,
  miniMetricSchema,
  tabPromotionChipSchema,
  draftEditBlockSchema,
  inlineBlockSchema,
  parseInlineBlocks,
  extractAutoAuthorized,
  type BilingualLabel,
  type DataCaptureCard,
  type ConfirmationCard,
  type FileRequestCard,
  type MicroActionCard,
  type MiniMetric,
  type TabPromotionChip,
  type DraftEditBlock,
  type InlineBlock,
  type InlineTable,
  type InlineChart,
  type InlineWizard,
  type InlineWorkflow,
  type InlineComparison,
  type InlineSection,
  type InlineDashboard,
  type DraftPreviewBlock,
  type ParseInlineBlocksResult,
  type AutoAuthorized,
  type ExtractAutoAuthorizedResult,
} from './inline-blocks.js';

export {
  draftPreviewBlockSchema,
} from './draft-preview-block.js';

export {
  DRAFT_EDIT_FIELD_KINDS,
  type DraftEditField,
} from './draft-edit-block.js';

export {
  inlineTableSchema,
  inlineChartSchema,
  inlineWizardSchema,
  inlineWorkflowSchema,
  inlineComparisonSchema,
  inlineSectionSchema,
  inlineDashboardSchema,
  richInlineBlockSchema,
  RICH_INLINE_BLOCK_TYPES,
  type RichInlineBlock,
} from './rich-inline-blocks.js';
