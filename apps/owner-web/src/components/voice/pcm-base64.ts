'use client';

/**
 * pcm-base64.ts — base64 <-> PCM16 byte conversion for the realtime voice
 * wire protocol.
 *
 * The gateway voice bridge (`brain-voice.hono.ts`) speaks JSON on BOTH
 * directions: mic frames go UP as `{ type:'audio', base64 }` and model audio
 * comes DOWN as `{ kind:'audio', base64 }`, where `base64` is the
 * base64-encoding of raw mono PCM16 little-endian bytes. These helpers do that
 * encode/decode in a way that works in the browser AND under jsdom (vitest) —
 * using the universally-available `btoa`/`atob` rather than Node's `Buffer`,
 * which is not present in the client bundle.
 *
 * Encoding in chunks avoids `String.fromCharCode(...hugeArray)` call-stack
 * overflows on large frames.
 *
 * Discipline:
 *   - No mutation of inputs; returns fresh values.
 *   - <50 lines per function; nesting <4.
 *   - Never throws — decode failures return null, encode of empty → ''.
 */

/** Chunk size for the fromCharCode fan-out (keeps the arg list bounded). */
const ENCODE_CHUNK = 0x8000;

/** True when base64 codecs (`btoa`/`atob`) exist in this runtime. */
function hasBase64Codec(): boolean {
  return typeof btoa === 'function' && typeof atob === 'function';
}

/**
 * Base64-encode a PCM16 (or any binary) ArrayBuffer. Returns '' for an empty
 * buffer or a runtime missing the codec (caller treats '' as "skip this
 * frame").
 */
export function pcmToBase64(pcm: ArrayBuffer): string {
  if (pcm.byteLength === 0 || !hasBase64Codec()) return '';
  const bytes = new Uint8Array(pcm);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK) {
    const slice = bytes.subarray(offset, offset + ENCODE_CHUNK);
    binary += String.fromCharCode(...slice);
  }
  try {
    return btoa(binary);
  } catch {
    return '';
  }
}

/**
 * Base64-decode to a fresh PCM16 ArrayBuffer. Returns null on any malformed
 * input or a runtime missing the codec, so the caller can drop the frame
 * instead of feeding garbage to the audio player.
 */
export function base64ToPcm(base64: string): ArrayBuffer | null {
  if (base64.length === 0 || !hasBase64Codec()) return null;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
}
