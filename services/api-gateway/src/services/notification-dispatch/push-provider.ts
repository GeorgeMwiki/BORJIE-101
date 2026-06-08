/**
 * Push-notification provider seam for the notification-dispatch worker.
 *
 * Same pattern as the email + SMS provider seams: the dispatcher
 * depends on a port (`PushProvider`), not a concrete rail. Swap the
 * stub for a real adapter at composition time. Backs the `app_push`
 * message channel.
 *
 * Real adapters live under `./push-providers/`:
 *   - expo.ts        (Expo Push API — iOS + Android)
 *   - composite.ts   (env-driven router; room for FCM / APNS later)
 *
 * Device tokens are stored in `device_push_tokens` (migration 0139);
 * mobile apps register them via `routes/me/device-tokens.hono.ts`.
 *
 * Composition resolves the provider in this priority order:
 *   1. Composite (Expo) unless `PUSH_DISABLED=true`
 *   2. Stub (`provider_not_configured`)
 */
import { randomUUID } from 'crypto';

import { createPushProviderFromEnv } from './push-providers/composite';
import type {
  PushProvider,
  PushProviderInput,
  PushProviderResult,
} from './push-providers/types';

export type {
  PushProvider,
  PushProviderInput,
  PushProviderResult,
} from './push-providers/types';

/**
 * Stub push provider — returns a deterministic `failed` result with
 * `errorCode = 'provider_not_configured'`. Used until push is wired /
 * when `PUSH_DISABLED=true`.
 */
export function createStubPushProvider(): PushProvider {
  return {
    name: 'stub-push',
    configured: false,
    async send(_input: PushProviderInput): Promise<PushProviderResult> {
      return {
        status: 'failed',
        errorCode: 'provider_not_configured',
        errorMessage:
          'No real push provider configured; stub returns failed.',
        retryable: false,
        provider: 'stub-push',
      };
    },
  };
}

/**
 * Resolve the production push provider:
 *   - Composite (Expo) unless `PUSH_DISABLED=true`.
 *   - Stub otherwise (so the worker logs `provider_not_configured`).
 */
export function resolvePushProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PushProvider {
  const composite = createPushProviderFromEnv(env);
  return composite ?? createStubPushProvider();
}

/**
 * In-memory test provider — succeeds and records sent payloads.
 * Used by tests, not in production composition.
 */
export function createInMemoryPushProvider(): PushProvider & {
  readonly sent: ReadonlyArray<PushProviderInput>;
} {
  const sent: PushProviderInput[] = [];
  return {
    name: 'in-memory-push',
    configured: true,
    get sent() {
      return [...sent];
    },
    async send(input) {
      sent.push(input);
      return {
        status: 'sent',
        providerRef: `mem_${randomUUID()}`,
        provider: 'in-memory-push',
      };
    },
  };
}
