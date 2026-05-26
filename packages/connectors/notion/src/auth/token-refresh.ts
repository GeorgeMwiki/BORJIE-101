/**
 * Notion token rotation.
 *
 * As of 2026, Notion treats integration access_tokens as long-lived
 * bearer credentials with no `refresh_token` flow. Rotation is therefore
 * operator-initiated: the operator re-runs the OAuth install in the
 * Notion admin console, and the connector swaps in the new token.
 *
 * This module exposes the rotation seam — replace the encrypted-at-rest
 * blob, leave the rest of the row intact.
 */

import type { EncryptedCredentialStore } from '../types.js';
import type { NotionCredentials } from './oauth.js';

export interface NotionRotationInput {
  readonly newAccessToken: string;
}

export async function rotateNotionAccessToken(
  existing: NotionCredentials,
  input: NotionRotationInput,
  store: EncryptedCredentialStore,
): Promise<NotionCredentials> {
  if (input.newAccessToken.length === 0) {
    throw new Error('newAccessToken must be non-empty');
  }
  const encryptedAccessToken = await store.seal(input.newAccessToken);
  return {
    ...existing,
    encryptedAccessToken,
  };
}
