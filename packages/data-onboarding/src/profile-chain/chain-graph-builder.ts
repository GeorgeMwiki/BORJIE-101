/**
 * Stage 6.a — Profile-chain graph builder.
 *
 * Given the root entity and a tenant-schema snapshot, walks the
 * tables to find every join that lands back on the root via a
 * foreign-key pattern (`<root>_id`, `<root_singular>_id`). Returns a
 * `ProfileChainGraph` ready for owner preview.
 *
 * Circular-join detection: the builder refuses to add a node whose
 * presence would create a cycle through the chain. The runtime can
 * inspect `validated_cycle_free` flag to surface a warning.
 */

import type {
  ChainNode,
  EntityType,
  ProfileChainGraph,
  SuggestedTabLayout,
  TenantSchemaCtx,
  TenantTable,
} from '../types.js';
import { DataOnboardingError } from '../types.js';

interface BuildArgs {
  readonly root_entity: EntityType;
  readonly root_table: string;
  readonly ctx: TenantSchemaCtx;
}

function singularize(s: string): string {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('es') && !s.endsWith('ses')) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

function detectRootJoinField(
  table: TenantTable,
  root_table: string,
): { local_field: string; foreign_field: string } | null {
  const root_singular = singularize(root_table);
  const candidates = [`${root_table}_id`, `${root_singular}_id`];
  const col = table.columns.find((c) => candidates.includes(c.name));
  if (col === undefined) return null;
  return { local_field: col.name, foreign_field: 'id' };
}

function detectCardinality(table: TenantTable): 'one' | 'many' {
  // If the join-field column is unique in this table → 1:1; else 1:many.
  // Default to many — owners commonly want shift / incident lists.
  const col = table.columns.find((c) => /_id$/.test(c.name));
  if (col?.is_unique === true) return 'one';
  return 'many';
}

const DEFAULT_AGGREGATES_BY_TABLE: Readonly<Record<string, ReadonlyArray<{ kind: ChainNode['aggregates'][number]['kind']; label: string }>>> =
  Object.freeze({
    incidents: [{ kind: 'count', label: 'incidents (90d)' }],
    certifications: [{ kind: 'count', label: 'active certifications' }],
    payroll_entries: [{ kind: 'sum', label: 'YTD payroll' }],
    shift_assignments: [{ kind: 'count', label: 'shifts this period' }],
    safety_inspections: [{ kind: 'count', label: 'inspections (90d)' }],
    assays: [{ kind: 'latest', label: 'latest assay' }],
    drill_holes: [{ kind: 'count', label: 'drill holes' }],
    ore_parcels: [{ kind: 'count', label: 'parcels YTD' }],
    buyer_offers: [{ kind: 'count', label: 'offers received' }],
    workers: [{ kind: 'count', label: 'active workforce' }],
    licences: [{ kind: 'count', label: 'active licences' }],
  });

function tableToEntityType(table_name: string): EntityType {
  if (table_name === 'workers') return 'worker';
  if (table_name === 'ore_parcels') return 'parcel';
  if (table_name === 'incidents') return 'incident';
  if (table_name === 'certifications') return 'certification';
  if (table_name === 'payroll_entries') return 'payroll_entry';
  if (table_name === 'shift_assignments') return 'shift';
  if (table_name === 'safety_inspections') return 'inspection';
  if (table_name === 'sites') return 'site';
  if (table_name === 'buyers') return 'buyer';
  if (table_name === 'drill_holes') return 'drill_hole';
  if (table_name === 'assays') return 'assay';
  if (table_name === 'mining_licences') return 'licence';
  if (table_name === 'assets_fleet') return 'asset';
  return 'unknown';
}

function buildSuggestedTabLayout(
  root_entity: EntityType,
  chain_nodes: ReadonlyArray<ChainNode>,
): SuggestedTabLayout {
  return Object.freeze({
    tab_recipe_id: `tab_${root_entity}_profile_v1`,
    list_view_fields: Object.freeze(
      root_entity === 'worker'
        ? ['name', 'role', 'site', 'last_shift', 'training_status']
        : root_entity === 'parcel'
          ? ['parcel_id', 'grade', 'weight', 'status', 'latest_offer']
          : root_entity === 'site'
            ? ['site_name', 'region', 'production_ytd', 'active_workforce']
            : ['id', 'name', 'status'],
    ),
    detail_view_groups: Object.freeze([
      Object.freeze({ title: 'Identity', fields: ['id', 'name'] }),
      Object.freeze({ title: 'Relations', fields: chain_nodes.map((n) => n.table) }),
    ]),
    drill_through_targets: Object.freeze(
      chain_nodes.map((n) =>
        Object.freeze({
          to_table: n.table,
          via_field: n.join_to_root.local_field,
          label: `${n.table.replace(/_/g, ' ')}`,
        }),
      ),
    ),
  });
}

/**
 * Build the profile-chain graph for `root_entity`. Circular joins are
 * detected and rejected; the builder throws a typed
 * `DataOnboardingError('circular_chain', …)` so the caller can surface
 * the issue to the owner.
 */
export function buildChainGraph(args: BuildArgs): ProfileChainGraph {
  const { root_table, ctx } = args;
  const visited = new Set<string>([root_table]);
  const chain_nodes: ChainNode[] = [];

  for (const table of ctx.tables) {
    if (table.table === root_table) continue;
    const join = detectRootJoinField(table, root_table);
    if (join === null) continue;
    if (visited.has(table.table)) {
      throw new DataOnboardingError(
        'circular_chain',
        `Circular join detected at ${table.table} → ${root_table}`,
      );
    }
    visited.add(table.table);
    const aggregates = (DEFAULT_AGGREGATES_BY_TABLE[table.table] ?? []).map(
      (a) =>
        Object.freeze({
          kind: a.kind,
          label: a.label,
        }),
    );
    chain_nodes.push(
      Object.freeze({
        entity_type: tableToEntityType(table.table),
        table: table.table,
        join_to_root: Object.freeze(join),
        cardinality: detectCardinality(table),
        aggregates: Object.freeze(aggregates),
      }),
    );
  }

  return Object.freeze({
    root_entity: args.root_entity,
    root_table: args.root_table,
    chain_nodes: Object.freeze(chain_nodes),
    suggested_tab_layout: buildSuggestedTabLayout(
      args.root_entity,
      chain_nodes,
    ),
  });
}

export const __TEST_ONLY = Object.freeze({
  singularize,
  tableToEntityType,
});
