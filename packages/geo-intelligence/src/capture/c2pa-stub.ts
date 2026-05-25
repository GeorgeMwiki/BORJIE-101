/**
 * Lightweight C2PA-style signature stub for field captures.
 *
 * The full C2PA implementation lives in
 * `packages/content-studio/src/c2pa/`. That implementation depends on a
 * KMS signer and isn't appropriate to import into the mobile capture
 * path, which runs offline and signs on-device.
 *
 * Here we produce a deterministic SHA-256 over the capture payload and
 * label it as a C2PA "claim signature placeholder". Roundtrip:
 *
 *   sign({ kind:'photo', captureId, capturedAt, location, surveyorId,
 *          payloadHashHex })  ->  signatureHex
 *   verify(payload, signatureHex) -> boolean
 *
 * This isn't legally meaningful provenance — production deployments
 * MUST swap in the content-studio signer (or Truepic / Adobe CA SDK)
 * before relying on this signature for anything beyond UI demos.
 */

import { createHash, createHmac } from 'node:crypto';

const PLACEHOLDER_SECRET = 'borjie-c2pa-stub-v0';

export interface C2paSignaturePayload {
  readonly captureId: string;
  readonly kind: string;
  readonly capturedAt: string;
  readonly surveyorUserId: string;
  readonly tenantId: string;
  readonly payloadHashHex: string;
  readonly location?: { readonly lat: number; readonly lng: number };
}

export function hashCapturePayload(bytes: ArrayBuffer | Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes as ArrayBuffer);
  return createHash('sha256').update(buf).digest('hex');
}

export function signCapture(payload: C2paSignaturePayload, secret = PLACEHOLDER_SECRET): string {
  const canonical = [
    'v0',
    payload.captureId,
    payload.kind,
    payload.capturedAt,
    payload.surveyorUserId,
    payload.tenantId,
    payload.payloadHashHex,
    payload.location ? `${payload.location.lat.toFixed(6)},${payload.location.lng.toFixed(6)}` : '',
  ].join('|');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifyCapture(
  payload: C2paSignaturePayload,
  signatureHex: string,
  secret = PLACEHOLDER_SECRET,
): boolean {
  const expected = signCapture(payload, secret);
  return expected === signatureHex;
}
