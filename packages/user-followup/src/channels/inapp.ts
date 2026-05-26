/**
 * In-app channel adapter (port + reference no-op impl).
 *
 * The follow-up package never carries live HTTP / SMTP / WhatsApp
 * code. The host wires a real impl that emits to the chat bubble,
 * the daily card, or a tab-attached badge. This module provides
 * the contract + a deterministic reference impl for tests.
 */

import type {
  ChannelDispatcher,
  DispatchResult,
  FollowupCandidate,
} from '../types.js';

export interface InAppDispatcherDeps {
  /**
   * Pluggable hook invoked once per dispatch. Production wires this
   * to the realtime-rooms broadcast or the daily-card writer.
   */
  readonly emit?: (candidate: FollowupCandidate) => Promise<void> | void;
  readonly clock: () => Date;
}

export function createInAppDispatcher(
  deps: InAppDispatcherDeps,
): ChannelDispatcher {
  return {
    channel: 'inapp',
    async dispatch(candidate): Promise<DispatchResult> {
      try {
        if (deps.emit) {
          await deps.emit(candidate);
        }
        return {
          delivered: true,
          delivered_at: deps.clock().toISOString(),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'inapp_dispatch_failed';
        return {
          delivered: false,
          delivered_at: deps.clock().toISOString(),
          error: message,
        };
      }
    },
  };
}
