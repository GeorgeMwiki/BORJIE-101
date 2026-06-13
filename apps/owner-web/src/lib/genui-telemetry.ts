/**
 * Client-side self-healing beacon (owner-web).
 *
 * When the generative-UI renderer degrades to its UnknownKindCard (an unknown
 * render kind or a payload that failed its schema), it has ALREADY served the
 * customer a safe fallback — they are never blocked. This fire-and-forget
 * beacon makes that occurrence KNOWN to the platform: the gateway records it in
 * the INTERNAL-ADMIN self-healing console (never the owner) so the gap is fixed
 * for everyone (the platform loop). The customer-facing loop is already closed
 * by the degrade + the chat-native "ask Mwikila to render this another way"
 * path — never with fabricated data.
 *
 * Best-effort: a failed beacon never throws and never affects the surface.
 */
import { apiRequest } from './api-client';
import type { GenUiUnknownKindEventDetail } from '@borjie/genui';

export function reportGenuiUnknownKind(
  detail: GenUiUnknownKindEventDetail,
  surface: string,
): void {
  void apiRequest('/api/v1/genui-telemetry/unknown-kind', {
    method: 'POST',
    body: {
      kind: detail.kind,
      reason: detail.reason,
      ...(detail.message ? { message: detail.message } : {}),
      surface,
    },
  }).catch(() => {
    /* beacon is best-effort; the customer was already served the fallback */
  });
}
