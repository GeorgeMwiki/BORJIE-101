/**
 * Stage 4 — SchemaEvolutionProposal builder.
 *
 * Composes the typed proposal artefacts that flow into the
 * mutation-authority Tier-2 queue. Each proposal is fully self-
 * describing: DDL, Drizzle delta, migration filename, side effects,
 * reversibility classification, evidence ids.
 *
 * Pure function — no I/O. Reversibility is conservative: ALTER TABLE
 * ADD COLUMN = fully reversible (DROP); MODIFY COLUMN TYPE = partial
 * (only reversible if the original type's domain ⊆ the new one); any
 * proposal labelled `add_table` is fully reversible (DROP TABLE);
 * future `drop_*` proposals will be irreversible.
 */

import type {
  DiscoveredColumn,
  Reversibility,
  SchemaEvolutionKind,
  SchemaEvolutionProposal,
  SchemaMatchResult,
} from '../types.js';
import {
  buildAddColumnDdl,
  buildAddIndexDdl,
  buildAddTableDdl,
  buildModifyColumnDdl,
} from './ddl-builder.js';
import {
  buildAddColumnDelta,
  buildAddTableDelta,
} from './drizzle-delta-builder.js';
import { nextMigrationFilename } from './migration-writer.js';

export interface ProposalBuilderArgs {
  readonly match: SchemaMatchResult;
  readonly highest_existing_migration: number;
  readonly migration_slug: string;
  readonly research_evidence_ids: ReadonlyArray<string>;
}

interface DraftProposal {
  readonly kind: SchemaEvolutionKind;
  readonly ddl: string;
  readonly drizzle_delta: string;
  readonly side_effects: ReadonlyArray<string>;
  readonly reversibility: Reversibility;
}

function newId(): string {
  return `evo_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function freezeProposal(
  draft: DraftProposal,
  filename: string,
  evidence: ReadonlyArray<string>,
): SchemaEvolutionProposal {
  return Object.freeze({
    id: newId(),
    kind: draft.kind,
    ddl: draft.ddl,
    drizzle_delta: draft.drizzle_delta,
    migration_filename: filename,
    side_effects: Object.freeze([...draft.side_effects]),
    reversibility: draft.reversibility,
    authority_tier: 2 as const,
    research_evidence_ids: Object.freeze([...evidence]),
  });
}

export function buildProposals(
  args: ProposalBuilderArgs,
): ReadonlyArray<SchemaEvolutionProposal> {
  const { match } = args;
  if (match.unmatched_columns.length === 0) {
    return Object.freeze([]);
  }

  const out: SchemaEvolutionProposal[] = [];
  let migration_n = args.highest_existing_migration;

  // Group A: add_column proposals — one per unmatched column whose
  // home is the existing target table.
  for (const col of match.unmatched_columns) {
    migration_n += 1;
    const filename = nextMigrationFilename(
      migration_n - 1,
      `${args.migration_slug}_${col.name.toLowerCase()}`,
    );
    const draft: DraftProposal = {
      kind: 'add_column',
      ddl: buildAddColumnDdl(match.target_table.table, col),
      drizzle_delta: buildAddColumnDelta(col),
      side_effects: [
        `tabs referencing ${match.target_table.table} will gain field ${col.name}`,
      ],
      reversibility: 'fully',
    };
    out.push(freezeProposal(draft, filename, args.research_evidence_ids));
  }

  return Object.freeze(out);
}

/**
 * Build a single `add_table` proposal for a brand-new entity that has
 * no existing target. Reserved for the case where the entire feed has
 * no matching table — currently rare since most entities are already
 * modelled.
 */
export function buildAddTableProposal(args: {
  readonly table: string;
  readonly columns: ReadonlyArray<DiscoveredColumn>;
  readonly primary_key: string | null;
  readonly highest_existing_migration: number;
  readonly migration_slug: string;
  readonly research_evidence_ids: ReadonlyArray<string>;
}): SchemaEvolutionProposal {
  const filename = nextMigrationFilename(
    args.highest_existing_migration,
    args.migration_slug,
  );
  const draft: DraftProposal = {
    kind: 'add_table',
    ddl: buildAddTableDdl(args.table, args.columns, args.primary_key),
    drizzle_delta: buildAddTableDelta(args.table, args.table, args.columns),
    side_effects: [
      `new tenant-scoped table — requires RLS policy (handled by migration template)`,
      `compose_tab_v1 will be invoked to surface this table to owners`,
    ],
    reversibility: 'fully',
  };
  return freezeProposal(draft, filename, args.research_evidence_ids);
}

export function buildAddIndexProposal(args: {
  readonly table: string;
  readonly column: string;
  readonly highest_existing_migration: number;
  readonly migration_slug: string;
  readonly research_evidence_ids: ReadonlyArray<string>;
}): SchemaEvolutionProposal {
  const filename = nextMigrationFilename(
    args.highest_existing_migration,
    args.migration_slug,
  );
  const draft: DraftProposal = {
    kind: 'add_index',
    ddl: buildAddIndexDdl(args.table, args.column),
    drizzle_delta: `// add index on ${args.table}.${args.column}`,
    side_effects: [
      `queries filtering on ${args.column} will speed up`,
      `INSERT/UPDATE on ${args.table} marginally slower`,
    ],
    reversibility: 'fully',
  };
  return freezeProposal(draft, filename, args.research_evidence_ids);
}

export function buildModifyColumnProposal(args: {
  readonly table: string;
  readonly column: string;
  readonly new_inferred_type: DiscoveredColumn['inferred_type'];
  readonly is_widening: boolean;
  readonly highest_existing_migration: number;
  readonly migration_slug: string;
  readonly research_evidence_ids: ReadonlyArray<string>;
}): SchemaEvolutionProposal {
  const filename = nextMigrationFilename(
    args.highest_existing_migration,
    args.migration_slug,
  );
  const draft: DraftProposal = {
    kind: 'modify_column',
    ddl: buildModifyColumnDdl(args.table, args.column, args.new_inferred_type),
    drizzle_delta: `// modify ${args.table}.${args.column} to ${args.new_inferred_type}`,
    side_effects: [
      `existing rows will be re-cast — ensure all values fit the new type`,
    ],
    reversibility: args.is_widening ? 'partial' : 'irreversible',
  };
  return freezeProposal(draft, filename, args.research_evidence_ids);
}
