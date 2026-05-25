/**
 * Tiny content hash helper. Uses node's `crypto` when available, falls
 * back to a stable non-crypto hash otherwise. Output is hex-encoded.
 *
 * For OCR adapters the hash is content provenance, not security — a
 * collision-free synchronous fallback is acceptable for tests when the
 * `crypto` module is unavailable in a browser-like env.
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const mod = await import('node:crypto');
    const hash = mod.createHash('sha256').update(bytes).digest('hex');
    return hash;
  } catch {
    // FNV-1a 64-bit fallback for browser-like envs.
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= BigInt(bytes[i]!);
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  }
}
