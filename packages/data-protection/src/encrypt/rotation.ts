/**
 * Key rotation — re-wrap previously wrapped DEKs under a successor KEK.
 *
 * Envelope encryption means rotation does NOT require re-encrypting the
 * payload. We only need to:
 *   1. Unwrap the DEK with the old KeyManager + the original context.
 *   2. Wrap the same DEK with the new KeyManager + the same context.
 *   3. Update the EnvelopeBlob with the new WrappedDek; payload nonce +
 *      ciphertext are unchanged.
 *
 * The integrity hash changes because it covers `wrappedDek.contextHash`
 * which is identical pre- and post-rotation (same context) — so the
 * hash IS preserved iff the context didn't change. The recompute below
 * keeps the invariant ON.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  type EncryptionContext,
  type KeyManager,
} from './key-manager.js';
import type { EnvelopeBlob } from './envelope.js';

function integrityHashOf(input: {
  readonly algorithm: EnvelopeBlob['algorithm'];
  readonly contextHash: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}): string {
  const buf = new Uint8Array(
    input.algorithm.length +
      1 +
      input.contextHash.length +
      1 +
      input.nonce.length +
      1 +
      input.ciphertext.length,
  );
  let offset = 0;
  const algoBytes = utf8ToBytes(input.algorithm);
  buf.set(algoBytes, offset);
  offset += algoBytes.length;
  buf[offset++] = 0x7c;
  const ctxBytes = utf8ToBytes(input.contextHash);
  buf.set(ctxBytes, offset);
  offset += ctxBytes.length;
  buf[offset++] = 0x7c;
  buf.set(input.nonce, offset);
  offset += input.nonce.length;
  buf[offset++] = 0x7c;
  buf.set(input.ciphertext, offset);
  return bytesToHex(sha256(buf));
}

export async function rewrapEnvelope(input: {
  readonly oldManager: KeyManager;
  readonly newManager: KeyManager;
  readonly context: EncryptionContext;
  readonly blob: EnvelopeBlob;
}): Promise<EnvelopeBlob> {
  const { blob, context, newManager, oldManager } = input;
  const dek = await oldManager.unwrapDek({
    wrapped: blob.wrappedDek,
    context,
  });
  try {
    const wrapped = await newManager.wrapDek({ dek, context });
    return Object.freeze({
      algorithm: blob.algorithm,
      nonce: blob.nonce,
      ciphertext: blob.ciphertext,
      wrappedDek: wrapped,
      integrityHash: integrityHashOf({
        algorithm: blob.algorithm,
        contextHash: wrapped.contextHash,
        nonce: blob.nonce,
        ciphertext: blob.ciphertext,
      }),
    });
  } finally {
    dek.fill(0);
  }
}

/**
 * Batch-rotate: walk a stream of (blob, context) pairs and re-wrap each
 * one under `newManager`. Returns the count of successfully rotated
 * blobs + the list of failures.
 */
export async function batchRotate(input: {
  readonly oldManager: KeyManager;
  readonly newManager: KeyManager;
  readonly batch: ReadonlyArray<{
    readonly blob: EnvelopeBlob;
    readonly context: EncryptionContext;
  }>;
}): Promise<{
  readonly rewrapped: ReadonlyArray<EnvelopeBlob>;
  readonly failures: ReadonlyArray<{
    readonly index: number;
    readonly reason: string;
  }>;
}> {
  const rewrapped: EnvelopeBlob[] = [];
  const failures: Array<{ index: number; reason: string }> = [];
  for (let i = 0; i < input.batch.length; i++) {
    const entry = input.batch[i];
    if (!entry) {
      failures.push({ index: i, reason: 'missing entry' });
      continue;
    }
    try {
      const next = await rewrapEnvelope({
        oldManager: input.oldManager,
        newManager: input.newManager,
        context: entry.context,
        blob: entry.blob,
      });
      rewrapped.push(next);
    } catch (err) {
      failures.push({
        index: i,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return Object.freeze({
    rewrapped: Object.freeze(rewrapped),
    failures: Object.freeze(failures),
  });
}
