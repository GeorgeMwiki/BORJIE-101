/**
 * Pure graph builder — extracted from `useUiStateBeacon` so the
 * caller-args -> `UiStateGraph` translation can be unit-tested
 * without a React tree.
 */

import type {
  HoverTarget,
  LastUserEvent,
  TabState,
  UiStateGraph,
} from '../types.js';

export interface BuildGraphArgs {
  readonly tabs: ReadonlyArray<TabState>;
  readonly activeTabId: string | null;
  readonly activePanelId: string | null;
  readonly activeDialogId: string | null;
  readonly hoverTarget: HoverTarget | null;
  readonly scrollPosition: { tabId: string; y: number } | null;
  readonly lastUserEvent: LastUserEvent | null;
}

export function buildGraph(args: BuildGraphArgs): UiStateGraph {
  return {
    activeTabId: args.activeTabId,
    tabs: args.tabs,
    activePanelId: args.activePanelId,
    activeDialogId: args.activeDialogId,
    hoverTarget: args.hoverTarget,
    scrollPosition: args.scrollPosition,
    lastUserEvent: args.lastUserEvent,
  };
}
