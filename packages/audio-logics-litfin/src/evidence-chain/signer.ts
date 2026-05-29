/**
 * C2PA-style audio evidence signing + verification.
 *
 * Mirrors `packages/content-studio/src/c2pa/signer.ts` but with audio-specific
 * claim fields and a manifest schema designed to embed inside the audio
 * sidecar (we do not modify the audio bytes themselves; the manifest hashes
 * the original bytes so any subsequent edit invalidates the signature).
 *
 * In production callers may swap in the official `c2pa-node` adapter; the
 * pure-TS HMAC implementation here is deterministic, signature-stable, and
 * gives us a complete audit chain in CI without an external binary.
 *
 * Manifest schema:
 *   - version            "1.0"
 *   - audioHash          sha256 of the raw audio bytes
 *   - captureTimestampIso when the call was captured
 *   - captureDeviceFingerprint  opaque device id (e.g. asterisk PBX uuid)
 *   - tenantId           multi-tenant scope
 *   - transcriptionHash  sha256 of the canonical transcript JSON (optional)
 *   - consentId          link into the consent log (optional)
 *   - claims             arbitrary key/value evidence
 *   - claimSignature     `hmac-sha256:<keyId>:<hex>` — replaced on sign
 *   - signedAtIso        when the manifest was signed
 *   - signerKeyId        which key produced the signature
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AudioLogicsLitfinError,
  type AudioEvidenceManifest,
  type AudioSample,
  type EvidenceClaim,
  type EvidenceVerifyResult,
} from '../types.js';

export interface SigningKey {
  readonly id: string;
  readonly secret: string;
}

/**
 * Test / dev fixture key. NOT a production secret — `signAudioAsEvidence`
 * REFUSES this key in production (NODE_ENV === 'production'). The literal
 * value is reproducible so test snapshots stay stable across CI runs and
 * machines; operators MUST set `AUDIO_EVIDENCE_SIGNING_KEY_ID` +
 * `AUDIO_EVIDENCE_SIGNING_KEY_SECRET` (and inject via
 * `createAudioLogicsLitfin({ evidenceSigner })`) before any prod deploy.
 */
export const DEFAULT_DEV_KEY: SigningKey = Object.freeze({
  id: 'audio-evidence-dev-key',
  secret: 'borjie-audio-logics-litfin-dev-stub-secret-DO-NOT-USE-IN-PROD',
});

/**
 * Load the audio-evidence signing key from env vars. Returns `null` when
 * not configured. In production the caller MUST receive a non-null key or
 * the `refuseDevKeyInProduction` guard in `signAudioAsEvidence` will throw.
 */
export function loadAudioEvidenceSigningKeyFromEnv(): SigningKey | null {
  const id = process.env.AUDIO_EVIDENCE_SIGNING_KEY_ID;
  const secret = process.env.AUDIO_EVIDENCE_SIGNING_KEY_SECRET;
  if (!id || !secret) return null;
  return Object.freeze({ id, secret });
}

function refuseDevKeyInProduction(key: SigningKey): void {
  if (key.id === DEFAULT_DEV_KEY.id && process.env.NODE_ENV === 'production') {
    throw new AudioLogicsLitfinError(
      'audio-logics-litfin signer refuses to fall back to dev-stub key in production. ' +
        'Set AUDIO_EVIDENCE_SIGNING_KEY_ID + AUDIO_EVIDENCE_SIGNING_KEY_SECRET, or pass ' +
        'an explicit SigningKey via createAudioLogicsLitfin({ evidenceSigner }).',
      'evidence-dev-key-in-prod',
    );
  }
}

export interface SignAudioAsEvidenceArgs {
  readonly audio: AudioSample;
  readonly tenantId: string;
  readonly captureTimestampIso: string;
  readonly captureDeviceFingerprint: string;
  readonly transcriptionHash?: string;
  readonly consentId?: string;
  readonly claims?: ReadonlyArray<EvidenceClaim>;
  readonly signerKey?: SigningKey;
  readonly nowIso?: string;
}

/**
 * Wrap an audio buffer in a signed evidence manifest. Returns the manifest;
 * the caller persists the original audio bytes + manifest as a sidecar.
 */
export function signAudioAsEvidence(args: SignAudioAsEvidenceArgs): AudioEvidenceManifest {
  if (!args.tenantId) {
    throw new AudioLogicsLitfinError('tenantId required', 'evidence-missing-tenant');
  }
  if (args.audio.bytes.length === 0) {
    throw new AudioLogicsLitfinError('audio bytes empty', 'evidence-empty-audio');
  }
  const key = args.signerKey ?? DEFAULT_DEV_KEY;
  refuseDevKeyInProduction(key);

  const audioHash = createHash('sha256').update(args.audio.bytes).digest('hex');
  const claims = args.claims ?? [];

  const baseManifest: AudioEvidenceManifest = {
    version: '1.0',
    audioHash,
    captureTimestampIso: args.captureTimestampIso,
    captureDeviceFingerprint: args.captureDeviceFingerprint,
    tenantId: args.tenantId,
    ...(args.transcriptionHash !== undefined
      ? { transcriptionHash: args.transcriptionHash }
      : {}),
    ...(args.consentId !== undefined ? { consentId: args.consentId } : {}),
    claims,
    claimSignature: '',
    signedAtIso: args.nowIso ?? new Date().toISOString(),
    signerKeyId: key.id,
  };

  const canonical = canonicalise(baseManifest);
  const signature = createHmac('sha256', key.secret).update(canonical).digest('hex');

  return Object.freeze({
    ...baseManifest,
    claimSignature: `hmac-sha256:${key.id}:${signature}`,
  });
}

export interface VerifyEvidenceArgs {
  readonly audio: AudioSample;
  readonly manifest: AudioEvidenceManifest;
  readonly keys?: ReadonlyArray<SigningKey>;
}

/**
 * Round-trip verification:
 *   1. Recompute the audio hash and compare against the manifest claim
 *      (catches audio-tampering).
 *   2. Recanonicalise the manifest with claimSignature='' and re-HMAC.
 *      Compare via `timingSafeEqual`.
 */
export function verifyAudioEvidence(args: VerifyEvidenceArgs): EvidenceVerifyResult {
  const keys = args.keys ?? [DEFAULT_DEV_KEY];
  const sig = args.manifest.claimSignature;
  if (!sig) {
    return { valid: false, reason: 'missing-signature', claims: args.manifest.claims };
  }

  const recomputedAudioHash = createHash('sha256').update(args.audio.bytes).digest('hex');
  if (recomputedAudioHash !== args.manifest.audioHash) {
    return { valid: false, reason: 'audio-tampered', claims: args.manifest.claims };
  }

  const match = sig.match(/^(hmac-sha256):([^:]+):([0-9a-f]+)$/);
  if (!match) {
    return { valid: false, reason: 'malformed-signature', claims: args.manifest.claims };
  }
  const keyId = match[2]!;
  const presented = match[3]!;
  const key = keys.find((k) => k.id === keyId);
  if (!key) {
    return { valid: false, reason: 'unknown-key', claims: args.manifest.claims };
  }

  const stripped: AudioEvidenceManifest = {
    ...args.manifest,
    claimSignature: '',
  };
  const canonical = canonicalise(stripped);
  const expected = createHmac('sha256', key.secret).update(canonical).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(presented, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'manifest-tampered', claims: args.manifest.claims };
  }

  return {
    valid: true,
    claims: args.manifest.claims,
    signedBy: keyId,
    signedAtIso: args.manifest.signedAtIso,
  };
}

/**
 * Produce a stable, byte-exact JSON for signing. Keys are sorted; the
 * ordering must match between sign + verify or HMAC would mismatch.
 */
function canonicalise(manifest: AudioEvidenceManifest): string {
  // claims is an array of {key,value}; stable order is the caller's
  // responsibility. We sort by `key` to make ordering insensitive.
  const claims = [...manifest.claims].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const ordered = {
    audioHash: manifest.audioHash,
    captureDeviceFingerprint: manifest.captureDeviceFingerprint,
    captureTimestampIso: manifest.captureTimestampIso,
    claimSignature: manifest.claimSignature,
    claims,
    consentId: manifest.consentId ?? null,
    signedAtIso: manifest.signedAtIso,
    signerKeyId: manifest.signerKeyId,
    tenantId: manifest.tenantId,
    transcriptionHash: manifest.transcriptionHash ?? null,
    version: manifest.version,
  };
  return JSON.stringify(ordered);
}

/**
 * Build an opaque device fingerprint from a small bag of attributes the
 * capture device exposes. Stable for the same inputs; used as a soft
 * identifier in the manifest.
 */
export function buildCaptureDeviceFingerprint(input: {
  readonly providerId: string;
  readonly deviceId: string;
  readonly firmwareVersion?: string;
  readonly extraSalt?: string;
}): string {
  const material = [
    input.providerId,
    input.deviceId,
    input.firmwareVersion ?? '',
    input.extraSalt ?? randomUUID(),
  ].join('::');
  return createHash('sha256').update(material).digest('hex');
}
