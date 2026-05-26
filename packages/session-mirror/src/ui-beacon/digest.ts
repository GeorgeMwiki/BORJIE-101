/**
 * Pure digest helper for the UI-state beacon. Extracted from the
 * React hook so the digest logic can be unit-tested without spinning
 * up a DOM environment.
 */

import type { UiStateGraph } from '../types.js';

/**
 * Stable digest of a `UiStateGraph`. Deterministic for the same shape
 * so the beacon can skip redundant publications.
 */
export function digestOf(graph: UiStateGraph): string {
  const parts = [
    `at:${graph.activeTabId ?? ''}`,
    `pa:${graph.activePanelId ?? ''}`,
    `di:${graph.activeDialogId ?? ''}`,
    `tabs:${graph.tabs
      .map(
        (t) =>
          `${t.id}:${t.recipeVersion}:${t.isActive ? 1 : 0}:${t.isDirty ? 1 : 0}`,
      )
      .join('|')}`,
    `hov:${graph.hoverTarget ? `${graph.hoverTarget.tabId}/${graph.hoverTarget.fieldId ?? ''}` : ''}`,
    `scr:${graph.scrollPosition ? `${graph.scrollPosition.tabId}@${graph.scrollPosition.y}` : ''}`,
    `evt:${graph.lastUserEvent ? `${graph.lastUserEvent.kind}@${graph.lastUserEvent.ts}` : ''}`,
  ];
  return parts.join('|');
}
