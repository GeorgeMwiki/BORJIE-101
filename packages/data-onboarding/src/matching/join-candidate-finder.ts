/**
 * Stage 3.c — Join-candidate detection.
 *
 * Identifies cross-table foreign-key opportunities. A discovered
 * column named `worker_id` (or any `<entity>_id`) is a strong join
 * candidate to the singular-named table's primary key. Detection is
 * conservative — false positives waste an owner approval click;
 * false negatives let the owner add the join manually.
 */

import type {
  DiscoveredColumn,
  JoinCandidate,
  TenantTable,
} from '../types.js';

function snakeCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const FK_PATTERN = /^([a-z][a-z0-9_]*?)_id$/;

export function findJoinCandidates(
  discovered: ReadonlyArray<DiscoveredColumn>,
  tenant_tables: ReadonlyArray<TenantTable>,
): ReadonlyArray<JoinCandidate> {
  const out: JoinCandidate[] = [];

  for (const col of discovered) {
    const m = FK_PATTERN.exec(snakeCase(col.name));
    if (m === null) continue;
    const stem = m[1];
    if (stem === undefined) continue;

    // Try singular and plural forms.
    const candidates = [stem, `${stem}s`, `${stem}es`];

    for (const candidate_table of tenant_tables) {
      if (!candidates.includes(snakeCase(candidate_table.table))) continue;

      const pk = candidate_table.columns.find((c) => c.is_pk);
      if (pk === undefined) continue;

      out.push(
        Object.freeze({
          local_field: col.name,
          foreign_table: candidate_table.table,
          foreign_field: pk.name,
          confidence: col.nullability <= 0.05 ? 0.95 : 0.8,
        }),
      );
    }
  }

  return Object.freeze(out);
}
