/**
 * Revocation helpers \u2014 build a revocation list view and check membership.
 *
 * The service already exposes revoke(); this module provides a cached lookup
 * useful for high-volume MCP dispatch paths.
 */

import type { CertStore } from './types.js';

export class RevocationCache {
  private cache: ReadonlyMap<string, Set<string>> = new Map();
  private lastRefresh = 0;
  private readonly ttlMs: number;

  constructor(
    private readonly store: CertStore,
    ttlMs: number = 30_000,
  ) {
    this.ttlMs = ttlMs;
  }

  async isRevoked(tenantId: string, certId: string): Promise<boolean> {
    await this.ensureFresh(tenantId);
    return this.cache.get(tenantId)?.has(certId) ?? false;
  }

  async invalidate(tenantId: string): Promise<void> {
    const next = new Map(this.cache);
    next.delete(tenantId);
    this.cache = next;
    this.lastRefresh = 0;
  }

  private async ensureFresh(tenantId: string): Promise<void> {
    const age = Date.now() - this.lastRefresh;
    if (this.cache.has(tenantId) && age < this.ttlMs) return;
    const revocations = await this.store.listRevocations(tenantId);
    const next = new Map(this.cache);
    next.set(tenantId, new Set(revocations.map((r) => r.certId)));
    this.cache = next;
    this.lastRefresh = Date.now();
  }
}
