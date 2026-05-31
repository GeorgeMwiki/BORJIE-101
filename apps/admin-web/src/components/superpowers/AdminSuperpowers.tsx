'use client';

/**
 * Wave SUPERPOWERS — admin-web root mount.
 *
 * Mounts the always-on companions for the six admin superpowers:
 *   - AdminBulkActionDrawer  → Cmd+Shift+B opens the bulk composer
 *   - AdminHighlightOverlay  → listens for highlight bus events
 *
 * Chip rendering itself happens inside admin chat surfaces via
 * `AdminSuperpowerChips`. Keeping the always-on pieces in this small
 * wrapper lets `AdminShell` mount them in one place.
 */

import type { ReactElement } from 'react';
import { AdminBulkActionDrawer } from './AdminBulkActionDrawer';
import { AdminHighlightOverlay } from './AdminHighlightOverlay';

export function AdminSuperpowers(): ReactElement {
  return (
    <>
      <AdminBulkActionDrawer />
      <AdminHighlightOverlay />
    </>
  );
}
