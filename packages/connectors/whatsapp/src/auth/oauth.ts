/**
 * WhatsApp Business Cloud — System User token install flow.
 *
 * WhatsApp Business Cloud API uses a **System User token** issued from
 * the Meta Business Manager, NOT a short-lived OAuth code-exchange.
 * Tokens are long-lived (no expiry unless the operator rotates).
 *
 * Reference: Meta — "Get Started with Cloud API"
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 *   (visited 2026-05-26).
 *
 * Production wires `EncryptedCredentialStore` to the AES-GCM seal
 * routine; tests pass a passthrough.
 */

import type { EncryptedCredentialStore } from '../types.js';

/** Inputs the operator pastes into the install wizard. */
export interface WhatsappInstallInput {
  readonly tenantId: string;
  readonly wabaId: string;
  readonly phoneNumberIds: ReadonlyArray<string>;
  readonly systemUserAccessToken: string;
  readonly appSecret: string;
  readonly webhookVerifyToken: string;
}

/** Persisted credential row shape (one per tenant). */
export interface WhatsappCredentials {
  readonly tenantId: string;
  readonly wabaId: string;
  readonly phoneNumberIds: ReadonlyArray<string>;
  /** AES-GCM ciphertext sealed by EncryptedCredentialStore.seal. */
  readonly encryptedAccessToken: Uint8Array;
  /** AES-GCM ciphertext for the App Secret used in HMAC verification. */
  readonly encryptedAppSecret: Uint8Array;
  /** AES-GCM ciphertext for the webhook verify token. */
  readonly encryptedWebhookVerifyToken: Uint8Array;
  readonly createdAt: string;
}

/**
 * Build a `WhatsappCredentials` row from operator input. Every secret
 * is sealed before it leaves the function.
 */
export async function installWhatsappCredentials(
  input: WhatsappInstallInput,
  store: EncryptedCredentialStore,
  nowIso: () => string,
): Promise<WhatsappCredentials> {
  if (input.systemUserAccessToken.length === 0) {
    throw new Error('systemUserAccessToken must be non-empty');
  }
  if (input.appSecret.length === 0) {
    throw new Error('appSecret must be non-empty');
  }
  const [encryptedAccessToken, encryptedAppSecret, encryptedWebhookVerifyToken] =
    await Promise.all([
      store.seal(input.systemUserAccessToken),
      store.seal(input.appSecret),
      store.seal(input.webhookVerifyToken),
    ]);
  return {
    tenantId: input.tenantId,
    wabaId: input.wabaId,
    phoneNumberIds: input.phoneNumberIds,
    encryptedAccessToken,
    encryptedAppSecret,
    encryptedWebhookVerifyToken,
    createdAt: nowIso(),
  };
}
