/**
 * Wave SUPERPOWERS (admin-web) — proposedAction → chip mapper.
 *
 * The admin brain endpoint (`/brain/turn`) returns a single envelope
 * with an optional `proposedAction: { action: string; args?: object }`
 * field. When the action matches one of the six chip families we map
 * it onto a chip emission and publish via `emitAdminChip`. The
 * subscriber on the bus (`useAdminChipEmissions`) buckets it onto the
 * matching assistant turn.
 *
 * This is the bridge between the JSON-envelope `/brain/turn` and the
 * upcoming SSE `/brain/teach`-style endpoint — same chip contract,
 * same renderer, no FE churn when the backend stream lands.
 */

import {
  uiNavigateChipSchema,
  uiPrefillChipSchema,
  uiHighlightChipSchema,
  uiShareChipSchema,
  uiBulkChipSchema,
  uiBookmarkChipSchema,
} from './chip-schemas';
import { emitAdminChip } from './use-admin-chip-emissions';

export interface AdminProposedAction {
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/**
 * Map a brain envelope `proposedAction` to a validated chip event.
 *
 * Returns `true` when an emission was dispatched (caller can use that
 * to decide whether to skip the legacy "proposed action" banner). The
 * function is a no-op when the action is not a chip family or when
 * validation against the chip schema fails — the brain may legitimately
 * propose admin actions that are not chip-renderable.
 */
export function mapProposedActionToChip(
  turnKey: string,
  proposedAction: AdminProposedAction | null,
): boolean {
  if (!proposedAction || typeof proposedAction.action !== 'string') {
    return false;
  }
  const args = proposedAction.args ?? {};
  switch (proposedAction.action) {
    case 'ui_navigate':
    case 'mining.ui.navigate': {
      const parsed = uiNavigateChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_navigate', chip: parsed.data });
      return true;
    }
    case 'ui_prefill':
    case 'mining.ui.prefill': {
      const parsed = uiPrefillChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_prefill', chip: parsed.data });
      return true;
    }
    case 'ui_highlight':
    case 'mining.ui.highlight': {
      const parsed = uiHighlightChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_highlight', chip: parsed.data });
      return true;
    }
    case 'ui_share':
    case 'mining.ui.share_view': {
      const parsed = uiShareChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_share', chip: parsed.data });
      return true;
    }
    case 'ui_bulk':
    case 'admin.ui.bulk_action': {
      const parsed = uiBulkChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_bulk', chip: parsed.data });
      return true;
    }
    case 'ui_bookmark':
    case 'mining.ui.bookmark': {
      const parsed = uiBookmarkChipSchema.safeParse(args);
      if (!parsed.success) return false;
      emitAdminChip({ turnKey, family: 'ui_bookmark', chip: parsed.data });
      return true;
    }
    default:
      return false;
  }
}
