/**
 * Wave SUPERPOWERS (admin-web) — public surface.
 *
 * Exports the chip renderer + always-on companions so the admin shell,
 * command palette, and chat surfaces can reach a single import path.
 */

export {
  AdminSuperpowerChips,
  UndoChip,
  type AdminSuperpowerChipsProps,
} from './AdminSuperpowerChips';
export { AdminSuperpowers } from './AdminSuperpowers';
export { AdminBulkActionDrawer } from './AdminBulkActionDrawer';
export { AdminHighlightOverlay } from './AdminHighlightOverlay';

export {
  uiNavigateChipSchema,
  uiPrefillChipSchema,
  uiHighlightChipSchema,
  uiShareChipSchema,
  uiBulkChipSchema,
  uiBookmarkChipSchema,
  ADMIN_BULK_ACTIONS,
  ADMIN_BULK_ENTITY_TYPES,
  HIGH_IMPACT_ADMIN_ACTIONS,
  type UiNavigateChip,
  type UiPrefillChip,
  type UiHighlightChip,
  type UiShareChip,
  type UiBulkChip,
  type UiBookmarkChip,
} from './chip-schemas';

export {
  publishAdminFormPrefill,
  publishAdminHighlight,
  openAdminBulkDrawer,
  ADMIN_FORM_PREFILL_EVENT_NAME,
  ADMIN_HIGHLIGHT_EVENT_NAME,
  ADMIN_BULK_DRAWER_EVENT_NAME,
  type FormPrefillEvent,
  type HighlightEvent,
} from './bus';

export {
  postSuperpowerJson,
  ADMIN_SUPERPOWER_ENDPOINTS,
} from './api';

export {
  emitAdminChip,
  useAdminChipEmissions,
  ADMIN_CHIP_EMIT_EVENT_NAME,
  type ChipBuckets,
  type ChipEmitEvent,
} from './use-admin-chip-emissions';

export {
  mapProposedActionToChip,
  type AdminProposedAction,
} from './proposed-action-mapper';
