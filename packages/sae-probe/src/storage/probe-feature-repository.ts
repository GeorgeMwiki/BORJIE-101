/**
 * In-memory reference `ProbeFeatureRepository` (Wave 18BB-gap).
 *
 * Production wires a Postgres-backed adapter against the
 * `sae_probe_features` Drizzle schema in `@borjie/database`. Tests
 * and short-lived worker contexts use this in-memory impl.
 */

import type { ProbeFeatureRepository, SaeProbeFiring } from '../types.js';

export function createInMemoryProbeFeatureRepository(): ProbeFeatureRepository {
  const rows: Array<SaeProbeFiring> = [];

  return {
    async insert(firing) {
      rows.push(firing);
    },

    async findFirings(tenant_id, feature_id, from, to) {
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const out: Array<SaeProbeFiring> = [];
      for (const r of rows) {
        if (r.tenant_id !== tenant_id || r.feature_id !== feature_id) {
          continue;
        }
        const t = new Date(r.detected_at).getTime();
        if (t >= fromMs && t < toMs) {
          out.push(r);
        }
      }
      return out;
    },
  };
}
