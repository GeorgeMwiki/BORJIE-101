'use client';

/**
 * Wave SUPERPOWERS — admin-web root mount.
 *
 * Mounts the always-on companions for the six admin superpowers:
 *   - AdminBulkActionDrawer     → Cmd+Shift+B opens the bulk composer
 *   - AdminHighlightOverlay     → listens for highlight bus events
 *   - AdminFormPrefillReceiver  → listens for ui_prefill bus events and
 *                                 fills the target form (without it the
 *                                 "Pre-fill form" chip is a dead control)
 *
 * Chip rendering itself happens inside admin chat surfaces via
 * `AdminSuperpowerChips`. Keeping the always-on pieces in this small
 * wrapper lets `AdminShell` mount them in one place.
 */

import type { ReactElement } from 'react';
import { AdminBulkActionDrawer } from './AdminBulkActionDrawer';
import { AdminHighlightOverlay } from './AdminHighlightOverlay';
import { AdminFormPrefillReceiver } from './AdminSuperpowerChips';

export function AdminSuperpowers(): ReactElement {
  return (
    <>
      <AdminBulkActionDrawer />
      <AdminHighlightOverlay />
      <AdminFormPrefillReceiver />
    </>
  );
}
