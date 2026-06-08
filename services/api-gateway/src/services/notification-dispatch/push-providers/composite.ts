/**
 * Composite push provider + env-driven factory.
 *
 * Mirrors `sms-providers/composite.ts`. Today there is a single push
 * rail (Expo, covering iOS + Android), but the composite keeps the
 * dispatcher decoupled from the concrete rail and leaves room for a
 * future FCM / APNS adapter without re-shaping the seam.
 *
 * Enablement (kept deliberately simple, per the channel spec):
 *   - `configured = true`  when push can be *attempted* (default).
 *     The Expo access token is OPTIONAL — Expo accepts unauthenticated
 *     sends for projects without push security — so the absence of
 *     `EXPO_ACCESS_TOKEN` does NOT disable the channel.
 *   - `configured = false` only when explicitly disabled via
 *     `PUSH_DISABLED=true`. The composite then returns
 *     `provider_not_configured` (non-retryable) without any HTTP call.
 *
 * `createPushProviderFromEnv` returns `null` when push is disabled so
 * the caller can fall back to the stub, matching the SMS composite's
 * `null`-when-unconfigured contract.
 */
import type { PushProvider, PushProviderInput, PushProviderResult } from './types';
import {
  createExpoPushProvider,
  readExpoConfigFromEnv,
  type ExpoDeps,
} from './expo';

export type CompositePushProviderDeps = {
  /** The Expo rail, or null when push is disabled. */
  readonly expo: PushProvider | null;
};

export function createCompositePushProvider(
  deps: CompositePushProviderDeps,
): PushProvider {
  const name = deps.expo?.configured
    ? 'composite-push[expo]'
    : 'composite-push-empty';

  return {
    name,
    configured: deps.expo?.configured ?? false,
    async send(input: PushProviderInput): Promise<PushProviderResult> {
      if (deps.expo && deps.expo.configured) {
        return deps.expo.send(input);
      }
      return {
        status: 'failed',
        errorCode: 'provider_not_configured',
        errorMessage: 'No push provider configured (PUSH_DISABLED).',
        retryable: false,
        provider: name,
      };
    },
  };
}

/**
 * Build a composite push provider from the environment. Returns `null`
 * when push is explicitly disabled (`PUSH_DISABLED=true`) so the caller
 * can fall back to the stub provider; otherwise returns the Expo-backed
 * composite (token optional).
 */
export function createPushProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: ExpoDeps = {},
): PushProvider | null {
  if (isPushDisabled(env)) return null;
  const expo = createExpoPushProvider(readExpoConfigFromEnv(env), deps);
  return createCompositePushProvider({ expo });
}

function isPushDisabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.PUSH_DISABLED === 'true';
}
