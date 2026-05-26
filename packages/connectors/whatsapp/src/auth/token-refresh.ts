/**
 * WhatsApp token rotation.
 *
 * System User tokens never expire on their own; rotation is operator-
 * triggered. This module exposes the seam: replace the encrypted
 * access-token blob, leaving the rest of the credential row intact.
 *
 * Reference: Meta — "System users and tokens"
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 *   (visited 2026-05-26).
 */

import type { EncryptedCredentialStore } from '../types.js';
import type { WhatsappCredentials } from './oauth.js';

export interface WhatsappRotationInput {
  readonly newAccessToken: string;
}

/**
 * Produce a new credential row with the access-token blob rotated.
 * Other fields are preserved by reference (immutable spread).
 */
export async function rotateWhatsappAccessToken(
  existing: WhatsappCredentials,
  input: WhatsappRotationInput,
  store: EncryptedCredentialStore,
): Promise<WhatsappCredentials> {
  if (input.newAccessToken.length === 0) {
    throw new Error('newAccessToken must be non-empty');
  }
  const encryptedAccessToken = await store.seal(input.newAccessToken);
  return {
    ...existing,
    encryptedAccessToken,
  };
}
