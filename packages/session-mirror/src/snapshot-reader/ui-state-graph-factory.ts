/**
 * `UiStateGraph` factory — the SERVER side of Tier III.
 *
 * Constructs a fresh `UiStateGraph` for a session by reading the
 * latest row in `ui_state_snapshots`. If no row exists yet (the
 * session just started), an empty graph is returned — the MD treats
 * "no UI state yet" as "no anchored anticipatory proposal possible
 * for this session" and falls back to global heuristics.
 */

import type { UiStateGraph } from '../types.js';

export interface UiStateRowStore {
  /** Return the newest row for the session, or null if none exist. */
  readonly latestForSession: (
    sessionId: string,
  ) => Promise<UiStateGraph | null>;
}

export interface CreateUiStateGraphArgs {
  readonly sessionId: string;
  readonly store: UiStateRowStore;
}

export async function readUiStateGraph(
  args: CreateUiStateGraphArgs,
): Promise<UiStateGraph> {
  const row = await args.store.latestForSession(args.sessionId);
  return row ?? emptyGraph();
}

/** The canonical empty-graph shape — useful for tests + first-paint reads. */
export function emptyGraph(): UiStateGraph {
  return {
    activeTabId: null,
    tabs: [],
    activePanelId: null,
    activeDialogId: null,
    hoverTarget: null,
    scrollPosition: null,
    lastUserEvent: null,
  };
}
