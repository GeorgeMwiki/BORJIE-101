/**
 * WhatsApp channel adapter (port + reference impl).
 *
 * Text-only — voice is handled by the separate VOICE_GEMINI_LIVE_
 * SWAHILI_SPEC engine. The reference impl is no-op; tests inject
 * the `send` hook.
 */

import type {
  ChannelDispatcher,
  DispatchResult,
  FollowupCandidate,
} from '../types.js';

export interface WhatsAppSendPayload {
  readonly to_user_id: string;
  readonly text: string;
  readonly candidate: FollowupCandidate;
}

export interface WhatsAppDispatcherDeps {
  readonly send?: (payload: WhatsAppSendPayload) => Promise<void> | void;
  readonly clock: () => Date;
  /** WhatsApp Business templates have a 1024-char hard cap. */
  readonly maxChars?: number;
}

const WHATSAPP_DEFAULT_CHAR_CAP = 1024;

function truncateForWhatsApp(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap - 1)}…`;
}

export function createWhatsAppDispatcher(
  deps: WhatsAppDispatcherDeps,
): ChannelDispatcher {
  const cap = deps.maxChars ?? WHATSAPP_DEFAULT_CHAR_CAP;
  return {
    channel: 'whatsapp',
    async dispatch(candidate): Promise<DispatchResult> {
      try {
        if (deps.send) {
          await deps.send({
            to_user_id: candidate.user_id,
            text: truncateForWhatsApp(candidate.payload.text, cap),
            candidate,
          });
        }
        return {
          delivered: true,
          delivered_at: deps.clock().toISOString(),
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'whatsapp_dispatch_failed';
        return {
          delivered: false,
          delivered_at: deps.clock().toISOString(),
          error: message,
        };
      }
    },
  };
}
