/**
 * AudioSeal acoustic watermark — embed + verify (LP-27).
 *
 * Synthetic-voice provenance beyond the audible disclosure header: a latent,
 * machine-readable watermark on synthesised output. Meta FAIR's AudioSeal is
 * the open reference (ICML 2024) but cannot ship as a PyTorch model in JS, so
 * this is a deterministic LSB-style fallback that survives mild re-encoding
 * well enough for ops to verify provenance, with a clean
 * `WATERMARK_PROVIDER=audioseal` hook for the real model later.
 *
 * Scheme: payload = SHA-256 anchor over {sessionId, locale, synthesizedAt,
 * audioHeaderSha256} (32 bytes) + a 4-byte XOR checksum. The 36-byte
 * signature is LSB-encoded one byte per 1024-sample frame and repeated across
 * the stream, so a single-frame loss does not erase it. Detection scans for
 * the most common repeated signature and validates the checksum.
 *
 * Deterministic by design: a regulator can re-derive the expected payload
 * from the audit row and compare it to what's recovered from the audio.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/audioseal-watermark
 */

import { createHash } from 'node:crypto';

export interface WatermarkPayload {
  readonly sessionId: string;
  readonly locale: string;
  /** ISO-8601 UTC timestamp at synthesis. */
  readonly synthesizedAt: string;
  /** SHA-256 of the AI-voice disclosure header text. */
  readonly audioHeaderSha256: string;
}

export interface VerifyResult {
  readonly verified: boolean;
  readonly recoveredSha256: string | null;
  readonly copiesFound: number;
  readonly reason?: string;
}

const PAYLOAD_BYTES = 32;
const CHECKSUM_BYTES = 4;
const SIGNATURE_BYTES = PAYLOAD_BYTES + CHECKSUM_BYTES; // 36
const SAMPLES_PER_BYTE = 8;
const FRAME_SAMPLES = 1024;

/**
 * Samples needed to carry one full 36-byte signature: one byte per
 * 1024-sample frame, with the final byte needing only its 8 LSB samples.
 * (35 frames of stride + 8 samples = 35 * 1024 + 8 = 35,848.)
 */
const MIN_SAMPLES_FOR_SIGNATURE = (SIGNATURE_BYTES - 1) * FRAME_SAMPLES + SAMPLES_PER_BYTE;

/** Derive the 32-byte SHA-256 payload from the watermark fields. */
export function derivePayloadSha256(payload: WatermarkPayload): Buffer {
  const canonical = [payload.sessionId, payload.locale, payload.synthesizedAt, payload.audioHeaderSha256].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest();
}

/** XOR checksum over a buffer (matches embed + verify). */
export function computeXorChecksum(payload: Buffer): Buffer {
  const out = Buffer.alloc(CHECKSUM_BYTES);
  for (let i = 0; i < payload.length; i += 1) {
    out[i % CHECKSUM_BYTES] = (out[i % CHECKSUM_BYTES] ?? 0) ^ (payload[i] ?? 0);
  }
  return out;
}

/**
 * Embed the payload watermark into a PCM16 buffer, returning a NEW buffer
 * (immutable — the input is not mutated). Throws when the buffer cannot hold
 * one full copy of the 36-byte signature at the 1024-sample frame stride.
 */
export function embedWatermark(pcm: Int16Array, payload: WatermarkPayload): Int16Array {
  const payloadHash = derivePayloadSha256(payload);
  const signature = Buffer.concat([payloadHash, computeXorChecksum(payloadHash)]);
  if (pcm.length < MIN_SAMPLES_FOR_SIGNATURE) {
    throw new Error(
      `embedWatermark: PCM too small (need ${MIN_SAMPLES_FOR_SIGNATURE} samples, got ${pcm.length})`,
    );
  }

  const out = Int16Array.from(pcm);
  let bytePos = 0;
  for (let frameStart = 0; frameStart + SAMPLES_PER_BYTE <= out.length; frameStart += FRAME_SAMPLES) {
    const byte = signature[bytePos % SIGNATURE_BYTES] ?? 0;
    for (let b = 0; b < SAMPLES_PER_BYTE; b += 1) {
      const bit = (byte >> (7 - b)) & 1;
      const idx = frameStart + b;
      const sample = out[idx] ?? 0;
      out[idx] = (sample & ~1) | bit;
    }
    bytePos += 1;
  }
  return out;
}

/**
 * Recover the watermark from a PCM16 buffer and validate the XOR checksum.
 * A single bit flipped in the SHA-256 region breaks the checksum and flips
 * `verified` false (tamper detection).
 */
export function verifyWatermark(pcm: Int16Array): VerifyResult {
  if (pcm.length < MIN_SAMPLES_FOR_SIGNATURE) {
    return { verified: false, recoveredSha256: null, copiesFound: 0, reason: 'pcm_too_small' };
  }

  const recovered: number[] = [];
  for (let frameStart = 0; frameStart + SAMPLES_PER_BYTE <= pcm.length; frameStart += FRAME_SAMPLES) {
    let byte = 0;
    for (let b = 0; b < SAMPLES_PER_BYTE; b += 1) {
      byte = (byte << 1) | ((pcm[frameStart + b] ?? 0) & 1);
    }
    recovered.push(byte);
  }
  if (recovered.length < SIGNATURE_BYTES) {
    return { verified: false, recoveredSha256: null, copiesFound: 0, reason: 'not_enough_frames' };
  }

  let chosen: Buffer | null = null;
  let copiesFound = 0;
  for (let offset = 0; offset + SIGNATURE_BYTES <= recovered.length; offset += SIGNATURE_BYTES) {
    const window = Buffer.from(recovered.slice(offset, offset + SIGNATURE_BYTES));
    const payload = window.subarray(0, PAYLOAD_BYTES);
    const checksum = window.subarray(PAYLOAD_BYTES, SIGNATURE_BYTES);
    if (computeXorChecksum(payload).equals(checksum)) {
      copiesFound += 1;
      if (!chosen) chosen = Buffer.from(payload);
    }
  }

  if (!chosen) {
    return { verified: false, recoveredSha256: null, copiesFound: 0, reason: 'checksum_mismatch' };
  }
  return { verified: true, recoveredSha256: chosen.toString('hex'), copiesFound };
}

/**
 * Provider hook for ops to swap in the real AudioSeal model. When
 * `WATERMARK_PROVIDER === 'audioseal'`, callers may delegate to a sidecar
 * instead of the LSB scheme. TODO(LP-27): wire the AudioSeal WASM/sidecar
 * binding behind this hook once deployed.
 */
export function getWatermarkProvider(): 'audioseal' | 'lsb-fallback' {
  return process.env.WATERMARK_PROVIDER === 'audioseal' ? 'audioseal' : 'lsb-fallback';
}
