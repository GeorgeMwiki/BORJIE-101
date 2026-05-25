/**
 * Definition registry — built-in + tenant-injected definitions.
 *
 * The registry is keyed by (tenantId, definitionId) so a tenant can
 * publish its own version of a built-in (e.g. their custom
 * `polygon_draw_v2_trc` that adds extra checks) without affecting
 * other tenants. The built-ins are visible to every tenant.
 *
 * Resolution order:
 *   1. tenant-specific override
 *   2. built-in
 *   3. not-found
 */

import type { WorkflowDefinition } from '../types.js';
import { findDefinitionById, listBuiltInDefinitions } from './built-in.js';

export interface DefinitionRegistry {
  register(tenantId: string, definition: WorkflowDefinition): void;
  find(tenantId: string, definitionId: string): WorkflowDefinition | null;
  listForTenant(tenantId: string): ReadonlyArray<WorkflowDefinition>;
}

export function createDefinitionRegistry(): DefinitionRegistry {
  // tenantId → definitionId → definition
  const byTenant = new Map<string, Map<string, WorkflowDefinition>>();

  function tenantBucket(tenantId: string): Map<string, WorkflowDefinition> {
    let b = byTenant.get(tenantId);
    if (!b) {
      b = new Map();
      byTenant.set(tenantId, b);
    }
    return b;
  }

  return {
    register(tenantId, definition) {
      tenantBucket(tenantId).set(definition.id, definition);
    },
    find(tenantId, definitionId) {
      const t = byTenant.get(tenantId);
      const hit = t?.get(definitionId);
      if (hit) return hit;
      return findDefinitionById(definitionId);
    },
    listForTenant(tenantId) {
      const t = byTenant.get(tenantId);
      const tenantSpecific = t ? [...t.values()] : [];
      const tenantIds = new Set(tenantSpecific.map((d) => d.id));
      const builtIns = listBuiltInDefinitions().filter(
        (d) => !tenantIds.has(d.id),
      );
      return Object.freeze([...tenantSpecific, ...builtIns]);
    },
  };
}
