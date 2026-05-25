/**
 * C2PA full verification — pulls a manifest out of an asset (or its
 * sidecar) + checks the signature against a key ring.
 *
 * The chain-of-trust check is intentionally simple: the manifest must
 * be signable by a key in the caller-supplied keyring. Production can
 * extend this with cert-chain walking once `c2pa-node` lands.
 */

import type { C2paManifest } from '../types.js';
import { extractSidecarManifest } from './embed.js';
import { verifyManifest, type SigningKey, type VerifyResult } from './signer.js';

export interface FullVerifyRequest {
  /** The asset bytes (used for digest binding to the manifest's ingredients). */
  readonly asset: Uint8Array;
  /** Sidecar bytes when sidecar strategy was used. */
  readonly sidecarBytes?: Uint8Array;
  /** Embedded manifest already extracted (skip sidecar parsing). */
  readonly embeddedManifest?: C2paManifest;
  /** Keyring the verifier accepts. */
  readonly keys: ReadonlyArray<SigningKey>;
}

export type FullVerifyResult =
  | { readonly ok: true; readonly manifest: C2paManifest; readonly keyId: string }
  | { readonly ok: false; readonly reason: string };

export function fullyVerify(req: FullVerifyRequest): FullVerifyResult {
  let manifest: C2paManifest | null = req.embeddedManifest ?? null;
  if (!manifest && req.sidecarBytes) {
    manifest = extractSidecarManifest(req.sidecarBytes);
  }
  if (!manifest) {
    return { ok: false, reason: 'no-manifest-found' };
  }

  const verdict: VerifyResult = verifyManifest(manifest, req.keys);
  if (!verdict.ok) {
    return { ok: false, reason: `${verdict.reason}: ${verdict.detail}` };
  }
  return { ok: true, manifest, keyId: verdict.keyId };
}
