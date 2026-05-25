/**
 * Tiny content hash helper. Crypto-grade via node:crypto when
 * available, FNV-1a fallback for non-Node hosts (jsdom, edge runtime).
 *
 * The FNV path is *only* for provenance — never for security signing.
 * Audit chain hashing always runs on node:crypto.
 */

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  try {
    const mod = await import('node:crypto');
    return mod.createHash('sha256').update(input).digest('hex');
  } catch {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= BigInt(input[i] ?? 0);
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  }
}

/**
 * Synchronous variant for in-process use where node:crypto is
 * guaranteed (server-side audit chain). Falls back to FNV-1a if
 * createHash isn't available so unit tests don't crash on edge
 * runtimes.
 */
export function sha256HexSync(input: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('node:crypto') as typeof import('node:crypto');
    return crypto.createHash('sha256').update(input).digest('hex');
  } catch {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const bytes = new TextEncoder().encode(input);
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= BigInt(bytes[i] ?? 0);
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  }
}
