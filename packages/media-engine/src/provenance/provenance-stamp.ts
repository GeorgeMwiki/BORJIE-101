/**
 * Provenance stamp — watermark + C2PA-style manifest + SynthID flag.
 *
 * Every produced artifact is stamped before delivery. The stamp binds:
 *   1. a content hash (sha256 over the real bytes) — the hard binding,
 *   2. a manifest digest (the C2PA claim payload, signed by an INJECTED
 *      {@link ProvenanceSigner} when present, else an explicitly-unsigned
 *      digest — never a fabricated signature),
 *   3. a visible-watermark PLAN executed host-side (sharp / ffmpeg),
 *   4. the provider's SynthID-present flag (invisible watermark).
 *
 * The actual COSE/X.509/JUMBF embedding is the host's job (native deps);
 * this engine produces the verifiable claim + binding so the stamp is
 * always present and never empty.
 *
 * @module @borjie/media-engine/provenance/provenance-stamp
 */

import { createHash } from 'node:crypto';
import type {
  MediaProvenance,
  MediaRequestKind,
  ProvenanceSigner,
  WatermarkPlan,
} from '../types.js';

/** Default visible-watermark plan. Every public asset gets one. */
function planWatermark(label: string): WatermarkPlan {
  return {
    text: label,
    position: 'bottom_right',
    opacity: 0.85,
  };
}

export interface StampInput {
  readonly kind: MediaRequestKind;
  readonly body: Uint8Array;
  readonly synthIdPresent: boolean;
  /** Visible watermark label (brand string), already locale-correct. */
  readonly watermarkLabel: string;
  readonly stampedAt: string;
  readonly signer?: ProvenanceSigner;
}

/** sha256 hex of bytes. */
export function hashBytes(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Produce the provenance stamp. Always returns a stamp with a non-empty
 * watermark plan and a content hash; signing is real when a signer is
 * injected, otherwise the signer is `'unsigned'` and the digest is the
 * bare manifest hash (clearly marked — never a fake signature).
 */
export function stampProvenance(input: StampInput): MediaProvenance {
  const contentHash = hashBytes(input.body);
  const watermark = planWatermark(input.watermarkLabel);

  // The C2PA claim payload: canonical, deterministic.
  const manifestPayload = JSON.stringify({
    contentHash,
    kind: input.kind,
    synthIdPresent: input.synthIdPresent,
    watermark,
    stampedAt: input.stampedAt,
  });

  const signer = input.signer;
  const manifestDigest = signer
    ? signer.sign(manifestPayload)
    : createHash('sha256').update(manifestPayload).digest('hex');

  return {
    contentHash,
    manifestDigest,
    watermark,
    synthIdPresent: input.synthIdPresent,
    signer: signer ? signer.subject : 'unsigned',
    stampedAt: input.stampedAt,
  };
}
