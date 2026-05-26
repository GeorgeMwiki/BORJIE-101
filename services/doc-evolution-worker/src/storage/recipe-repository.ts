/**
 * recipe-repository — CRUD against `document_recipes`.
 *
 * `document_recipes` is global product config (RLS disabled per migration
 * 0019). All queries are service-account scoped.
 */

import type {
  DocumentRecipeRow,
  RecipeStatus,
} from '../types.js';

/**
 * Port shape — postgres-js Sql or a stub for tests.
 *
 * The shape is intentionally minimal: callers either invoke the tag (sql\`...\`)
 * or one of the two helpers we depend on (`unsafe`, `begin`).
 */
export interface SqlPort {
  <T = unknown>(strings: TemplateStringsArray, ...params: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
}

export interface RecipeRepository {
  listLive(): Promise<ReadonlyArray<DocumentRecipeRow>>;
  listByStatus(status: RecipeStatus): Promise<ReadonlyArray<DocumentRecipeRow>>;
  findById(
    id: string,
    version: number,
  ): Promise<DocumentRecipeRow | null>;
  /** Marks a recipe row's status. Used by Lock + Promote flows. */
  updateStatus(
    id: string,
    version: number,
    status: RecipeStatus,
    promotedBy: string | null,
  ): Promise<void>;
  /** Inserts a new version row when promoting a proposal. */
  insertNewVersion(args: NewRecipeVersionArgs): Promise<void>;
  /** Highest known version for a recipe id (live + shadow + draft). */
  maxVersionFor(id: string): Promise<number>;
}

export interface NewRecipeVersionArgs {
  readonly id: string;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly class: DocumentRecipeRow['class'];
  readonly compose_fn_ref: string;
  readonly required_inputs: ReadonlyArray<unknown>;
  readonly required_citations: ReadonlyArray<unknown>;
  readonly output_formats: ReadonlyArray<string>;
  readonly authority_tier: number;
  readonly approval_required: boolean;
  readonly promoted_by: string | null;
}

/**
 * Postgres-backed repository factory. Tests pass an in-memory port.
 */
export function createRecipeRepository(sql: SqlPort): RecipeRepository {
  return {
    async listLive() {
      return sql<DocumentRecipeRow>`
        select id, version, status, class, compose_fn_ref,
               coalesce(required_inputs, '[]'::jsonb) as required_inputs,
               coalesce(required_citations, '[]'::jsonb) as required_citations,
               output_formats, authority_tier, brand, approval_required,
               promoted_at, promoted_by, locked_at, created_at, updated_at
        from document_recipes
        where status = 'live'
      `;
    },
    async listByStatus(status) {
      return sql<DocumentRecipeRow>`
        select id, version, status, class, compose_fn_ref,
               coalesce(required_inputs, '[]'::jsonb) as required_inputs,
               coalesce(required_citations, '[]'::jsonb) as required_citations,
               output_formats, authority_tier, brand, approval_required,
               promoted_at, promoted_by, locked_at, created_at, updated_at
        from document_recipes
        where status = ${status}
      `;
    },
    async findById(id, version) {
      const rows = await sql<DocumentRecipeRow>`
        select id, version, status, class, compose_fn_ref,
               coalesce(required_inputs, '[]'::jsonb) as required_inputs,
               coalesce(required_citations, '[]'::jsonb) as required_citations,
               output_formats, authority_tier, brand, approval_required,
               promoted_at, promoted_by, locked_at, created_at, updated_at
        from document_recipes
        where id = ${id} and version = ${version}
        limit 1
      `;
      return rows[0] ?? null;
    },
    async updateStatus(id, version, status, promotedBy) {
      if (status === 'locked') {
        await sql`
          update document_recipes
          set status = ${status},
              locked_at = now(),
              updated_at = now()
          where id = ${id} and version = ${version}
        `;
      } else if (status === 'live') {
        await sql`
          update document_recipes
          set status = ${status},
              promoted_at = now(),
              promoted_by = ${promotedBy},
              updated_at = now()
          where id = ${id} and version = ${version}
        `;
      } else {
        await sql`
          update document_recipes
          set status = ${status},
              updated_at = now()
          where id = ${id} and version = ${version}
        `;
      }
    },
    async insertNewVersion(args) {
      await sql`
        insert into document_recipes (
          id, version, status, class, compose_fn_ref,
          required_inputs, required_citations, output_formats,
          authority_tier, brand, approval_required, promoted_by
        )
        values (
          ${args.id}, ${args.version}, ${args.status}, ${args.class},
          ${args.compose_fn_ref},
          ${JSON.stringify(args.required_inputs)}::jsonb,
          ${JSON.stringify(args.required_citations)}::jsonb,
          ${args.output_formats as ReadonlyArray<string> as unknown as string[]},
          ${args.authority_tier}, 'borjie', ${args.approval_required},
          ${args.promoted_by}
        )
        on conflict (id, version) do nothing
      `;
    },
    async maxVersionFor(id) {
      const rows = await sql<{ max: number | null }>`
        select max(version) as max from document_recipes where id = ${id}
      `;
      return rows[0]?.max ?? 0;
    },
  };
}
