/**
 * In-memory audit chain — deterministic, test-only impl that hashes
 * each payload by chaining against the prior hash.
 *
 * The production audit-chain (cryptographically signed) lives in
 * `packages/audit-hash-chain/`. This impl mirrors the shape (input
 * → hash string) so the package can be exercised without that
 * heavier dependency.
 */

import type { AuditChainPort } from '../types.js';

interface CreateInMemoryAuditChainOptions {
  /** Optional seed — useful for test snapshots. */
  readonly seed?: string;
}

export function createInMemoryAuditChain(
  options: CreateInMemoryAuditChainOptions = {},
): AuditChainPort & {
  /** Reads back the full chain in append order — test-only. */
  readonly chain: () => ReadonlyArray<{ readonly payload: Readonly<Record<string, unknown>>; readonly hash: string }>;
} {
  const chain: { payload: Readonly<Record<string, unknown>>; hash: string }[] = [];
  let prev = options.seed ?? 'genesis';

  function stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return `[${obj.map((v) => stableStringify(v)).join(',')}]`;
    }
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
  }

  return {
    async append(payload: Readonly<Record<string, unknown>>): Promise<string> {
      const input = `${prev}::${stableStringify(payload)}`;
      let h = 5381;
      for (let i = 0; i < input.length; i += 1) {
        h = ((h << 5) + h + input.charCodeAt(i)) | 0;
      }
      const hash = `aud${(h >>> 0).toString(16).padStart(8, '0')}`;
      chain.push({ payload, hash });
      prev = hash;
      return hash;
    },
    chain() {
      return chain;
    },
  };
}
