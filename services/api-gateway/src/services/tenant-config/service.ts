/**
 * Tenant-config service — Issue #207 (world-scale tenants).
 *
 * The lone production entrypoint for "what is this tenant's
 * country/currency/language/regulator-set/mineral allowlist?".
 * Callers MUST treat the returned object as immutable.
 *
 * Caching: deliberately none. The query is a single-row indexed
 * SELECT and tenant config changes immediately propagate. If
 * profiling shows a hotspot later, swap in a Redis-backed reader
 * — the public contract stays identical.
 */

import { createDrizzleTenantConfigPersistence } from './persistence.js';
import type { TenantConfig, TenantConfigService } from './types.js';

interface PersistenceDb {
  execute(query: unknown): Promise<unknown>;
}

interface TenantConfigPersistence {
  fetch(tenantId: string): Promise<TenantConfig | null>;
}

export interface TenantConfigServiceDeps {
  readonly persistence: TenantConfigPersistence;
}

class DefaultTenantConfigService implements TenantConfigService {
  constructor(private readonly deps: TenantConfigServiceDeps) {}

  async get(tenantId: string): Promise<TenantConfig> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('tenant-config: tenantId is required');
    }
    const row = await this.deps.persistence.fetch(tenantId);
    if (!row) {
      throw new Error(`tenant-config: tenant not found id=${tenantId}`);
    }
    return row;
  }
}

export function createTenantConfigService(
  deps: TenantConfigServiceDeps,
): TenantConfigService {
  return new DefaultTenantConfigService(deps);
}

export function createDrizzleTenantConfigService(
  db: PersistenceDb,
): TenantConfigService {
  return createTenantConfigService({
    persistence: createDrizzleTenantConfigPersistence(db),
  });
}
