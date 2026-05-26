/**
 * In-memory audit chain (Wave PERF-1).
 *
 * Reference implementation of `AuditChainPort`. Production hosts wire
 * `@borjie/audit-hash-chain` against the shared `ai_audit_chain`
 * table; this helper exists for tests + ephemeral workers.
 *
 * Hash function: a deterministic, dependency-free FNV-1a 64-bit
 * variant rendered as hex. Tests only check determinism — they do
 * NOT depend on the hash being cryptographically secure.
 */

import type { AuditChainPort } from '../types.js';

/**
 * Deterministic 64-bit FNV-1a over the JSON-stable payload. Returned
 * as a 16-character lowercase hex string. Stable across machines.
 */
export function stableHash(payload: Readonly<Record<string, unknown>>): string {
  const text = stringifyStable(payload);
  // FNV-1a 64-bit initial offset basis.
  let hi = 0xcbf2_9ce4;
  let lo = 0x8422_2325;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    lo ^= c;
    // 64-bit multiply by FNV prime (0x00000100000001B3) — split into
    // 32-bit hi/lo math.
    const r0 = lo * 0x1b3;
    const r1 = lo * 0x100 + hi * 0x1b3;
    const newLo = r0 >>> 0;
    const carry = Math.floor(r0 / 0x1_0000_0000);
    hi = (r1 + carry) >>> 0;
    lo = newLo;
  }
  const hiHex = hi.toString(16).padStart(8, '0');
  const loHex = lo.toString(16).padStart(8, '0');
  return `${hiHex}${loHex}`;
}

/** Deterministic JSON serialiser — sorts keys. */
function stringifyStable(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => stringifyStable(x)).join(',')}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stringifyStable(obj[k])}`,
  );
  return `{${parts.join(',')}}`;
}

/** In-memory `AuditChainPort` returning stable FNV-1a hashes. */
export function createInMemoryAuditChain(): AuditChainPort {
  return {
    async append(payload) {
      return stableHash(payload);
    },
  };
}
