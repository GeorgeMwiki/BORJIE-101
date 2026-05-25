/**
 * Reusable base ACL with optional caching. Subclass it to implement
 * `mapToDomain` + `mapFromDomain`; the base handles cache wiring.
 *
 * Cache key is the canonical-JSON form of the external object — so
 * two semantically-equal external rows hit the same cached domain
 * object even if their object-key order differs.
 */

import type { ACL } from "./types.js";

export interface BaseACLOptions {
  /** Cache size in entries. 0 disables caching. Default 0. */
  readonly cacheSize?: number;
}

export abstract class BaseACL<TDomain, TExternal> implements ACL<TDomain, TExternal> {
  private readonly cache: Map<string, TDomain> | null;
  private readonly cacheSize: number;

  constructor(opts: BaseACLOptions = {}) {
    this.cacheSize = opts.cacheSize ?? 0;
    this.cache = this.cacheSize > 0 ? new Map<string, TDomain>() : null;
  }

  protected abstract mapToDomain(external: TExternal): TDomain;
  protected abstract mapFromDomain(domain: TDomain): TExternal;

  toDomain(external: TExternal): TDomain {
    if (this.cache === null) {
      return this.mapToDomain(external);
    }
    const key = cacheKey(external);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const value = this.mapToDomain(external);
    if (this.cache.size >= this.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
    return value;
  }

  fromDomain(domain: TDomain): TExternal {
    return this.mapFromDomain(domain);
  }

  /** Test helper — expose cache size. */
  cacheEntries(): number {
    return this.cache?.size ?? 0;
  }
}

function cacheKey(value: unknown): string {
  return canonicalJson(value);
}

/** Local copy of canonicalJson — avoid a hard dep on audit-hash-chain. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}
