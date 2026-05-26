/**
 * `KpiTemplateRepository` — in-memory reference impl + SQL port shape.
 *
 * In-memory impl backs tests + ephemeral workers. The SQL port targets
 * migration 0058's `kpi_templates` table. Seed rows are inserted at
 * host bootstrap under sentinel tenant_id `__seed__` and remain read-
 * visible to every tenant per the migration's RLS policy.
 */

import {
  SEED_TENANT_ID,
  type KpiTemplateRepository,
  type RoleKpiTemplate,
} from '../types.js';

export function createInMemoryKpiTemplateRepository(): KpiTemplateRepository {
  const rows = new Map<string, RoleKpiTemplate>();
  const keyOf = (tenant_id: string, role: string): string =>
    `${tenant_id}::${role}`;
  return {
    async upsert(template) {
      rows.set(keyOf(template.tenant_id, template.role), template);
    },
    async get(tenant_id, role) {
      const tenantRow = rows.get(keyOf(tenant_id, role));
      if (tenantRow) return tenantRow;
      // Fall back to platform seed (mirrors migration 0058 RLS read).
      if (tenant_id !== SEED_TENANT_ID) {
        const seed = rows.get(keyOf(SEED_TENANT_ID, role));
        if (seed) return seed;
      }
      return null;
    },
    async list(tenant_id) {
      const out: RoleKpiTemplate[] = [];
      for (const t of rows.values()) {
        if (t.tenant_id === tenant_id || t.tenant_id === SEED_TENANT_ID) {
          out.push(t);
        }
      }
      out.sort((a, b) => a.role.localeCompare(b.role));
      return out;
    },
  };
}

export type { KpiTemplateRepository } from '../types.js';
