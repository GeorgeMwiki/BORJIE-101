/**
 * Email channel adapter (port + reference impl).
 *
 * Same shape as the in-app adapter — the host wires a live SMTP /
 * transactional-email client. The reference impl is no-op; tests
 * inject the `send` hook to assert calls.
 */

import type {
  ChannelDispatcher,
  DispatchResult,
  FollowupCandidate,
} from '../types.js';

export interface EmailSendPayload {
  readonly to_user_id: string;
  readonly subject: string;
  readonly body_md: string;
  readonly candidate: FollowupCandidate;
}

export interface EmailDispatcherDeps {
  readonly send?: (payload: EmailSendPayload) => Promise<void> | void;
  readonly clock: () => Date;
}

function buildSubject(candidate: FollowupCandidate): string {
  const head = candidate.payload.text.slice(0, 60).trim();
  return head.length > 0 ? head : `Mr. Mwikila follow-up (${candidate.source})`;
}

export function createEmailDispatcher(
  deps: EmailDispatcherDeps,
): ChannelDispatcher {
  return {
    channel: 'email',
    async dispatch(candidate): Promise<DispatchResult> {
      try {
        if (deps.send) {
          await deps.send({
            to_user_id: candidate.user_id,
            subject: buildSubject(candidate),
            body_md: candidate.payload.text,
            candidate,
          });
        }
        return {
          delivered: true,
          delivered_at: deps.clock().toISOString(),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'email_dispatch_failed';
        return {
          delivered: false,
          delivered_at: deps.clock().toISOString(),
          error: message,
        };
      }
    },
  };
}
