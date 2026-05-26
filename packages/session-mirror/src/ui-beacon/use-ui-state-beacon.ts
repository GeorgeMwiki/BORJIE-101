'use client';

/**
 * `useUiStateBeacon` — React hook that publishes the current
 * `UiStateGraph` to the SessionMirrorProvider on:
 *
 *   - tab focus / blur changes (via the `visibilitychange` event),
 *   - dialog open / close (via the `dialog` ref the caller passes),
 *   - panel-focus changes (via the `activePanelId` arg the caller
 *     updates),
 *   - and a ~5s heartbeat so a stale snapshot does not outlive an
 *     idle session.
 *
 * The hook does NOT walk the DOM — it stays out of the App Router's
 * RSC graph by relying on caller-supplied state (caller maps its own
 * tab manager / dialog manager into the `args` shape on every render).
 *
 * This keeps the hook a pure adapter: the caller owns the data, the
 * hook owns the protocol.
 */

import { useEffect, useRef } from 'react';
import {
  useCaptureEmit,
  useSessionScope,
} from '../provider/session-mirror-provider.js';
import type { HoverTarget, LastUserEvent, TabState } from '../types.js';
import { buildGraph } from './build-graph.js';
import { digestOf } from './digest.js';

const HEARTBEAT_MS = 5000;

export interface UseUiStateBeaconArgs {
  readonly tabs: ReadonlyArray<TabState>;
  readonly activeTabId: string | null;
  readonly activePanelId: string | null;
  readonly activeDialogId: string | null;
  readonly hoverTarget: HoverTarget | null;
  readonly scrollPosition: { tabId: string; y: number } | null;
  readonly lastUserEvent: LastUserEvent | null;
  /** Skip publication entirely. */
  readonly disabled?: boolean;
}

export function useUiStateBeacon(args: UseUiStateBeaconArgs): void {
  const emit = useCaptureEmit();
  const scope = useSessionScope();
  const lastDigestRef = useRef<string | null>(null);

  useEffect(() => {
    if (args.disabled || !scope) return;

    const graph = buildGraph({
      tabs: args.tabs,
      activeTabId: args.activeTabId,
      activePanelId: args.activePanelId,
      activeDialogId: args.activeDialogId,
      hoverTarget: args.hoverTarget,
      scrollPosition: args.scrollPosition,
      lastUserEvent: args.lastUserEvent,
    });
    const digest = digestOf(graph);

    function publish(): void {
      if (!scope) return;
      emit({
        kind: 'ui_state',
        emittedAt: new Date().toISOString(),
        sessionId: scope.sessionId,
        graph,
      });
    }

    // Emit on state change (only if the graph actually changed).
    if (lastDigestRef.current !== digest) {
      lastDigestRef.current = digest;
      publish();
    }

    // Heartbeat — keep the server's snapshot fresh.
    const interval = setInterval(publish, HEARTBEAT_MS);
    const onVisibility = (): void => publish();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [
    args.activeDialogId,
    args.activePanelId,
    args.activeTabId,
    args.disabled,
    args.hoverTarget,
    args.lastUserEvent,
    args.scrollPosition,
    args.tabs,
    emit,
    scope,
  ]);
}

