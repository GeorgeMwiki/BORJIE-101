/**
 * Stage 3.a — Tenant-schema loader.
 *
 * The data-onboarding package is I/O-free: this module declares the
 * contract by which the runtime injects a snapshot of the tenant's
 * relevant tables. Production wiring binds a Drizzle-backed
 * implementation in `@borjie/database` that reads from
 * `information_schema` filtered by `entity_type`. Tests inject an
 * in-memory snapshot.
 */

import type {
  EntityType,
  TenantSchemaCtx,
  TenantTable,
} from '../types.js';

export interface TenantSchemaLoader {
  load(entity_type: EntityType, tenant_id: string): Promise<TenantSchemaCtx>;
}

/**
 * In-memory loader for tests + dev. Production sites override this
 * with a Drizzle implementation.
 */
export function createStaticTenantSchemaLoader(
  snapshots: ReadonlyArray<TenantTable>,
): TenantSchemaLoader {
  return Object.freeze({
    async load(
      entity_type: EntityType,
      tenant_id: string,
    ): Promise<TenantSchemaCtx> {
      const relevant = snapshots.filter(
        (t) =>
          t.entity_type_hint === entity_type ||
          t.entity_type_hint === undefined,
      );
      return Object.freeze({
        tenant_id,
        tables: Object.freeze(relevant),
      });
    },
  });
}
