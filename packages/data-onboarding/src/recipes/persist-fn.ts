/**
 * Shared persist-function builder for the onboarding recipes.
 *
 * The data-onboarding package is I/O-free: it never imports Drizzle or
 * touches a connection. Stage-5 persistence is expressed entirely
 * through the `RowWriter` + `ProvenanceWriter` ports (see
 * `persistence/row-persister.ts`). Production binds a Drizzle-backed
 * implementation of those ports in the api-gateway composition root and
 * threads it in via the recipe FACTORIES (see `recipe-factory.ts`).
 *
 * This module produces the `persist` closure that the factory bakes
 * into each recipe:
 *
 *   - When `deps` is provided, `persist` delegates to the real
 *     `persistRows()` driver, which calls `writer.upsertRow(...)` per
 *     row and records provenance + an audit hash for every write.
 *
 *   - When `deps` is ABSENT (the default-export singletons used by unit
 *     tests + the recipe registry), `persist` FAILS CLOSED. It throws a
 *     typed `DataOnboardingError('persist_conflict', …)` rather than
 *     fabricating placeholder ids. The previous scaffold returned
 *     `target_row_id: 'stub_<i>'` and wrote NOTHING; that silent no-op
 *     is gone — a recipe that has not been given a writer can never
 *     pretend it persisted.
 */

import { persistRows } from '../persistence/row-persister.js';
import type { RowWriter } from '../persistence/row-persister.js';
import type { ProvenanceWriter } from '../persistence/row-provenance-writer.js';
import { DataOnboardingError } from '../types.js';
import type { AppliedSchema, PersistResult, Row } from '../types.js';

/**
 * Runtime persistence dependencies injected by the composition root.
 * Every field is required so a recipe can never half-persist: the
 * writer does the UPSERT, the provenance writer records the source ↔
 * row link, and the session/source identifiers seal the audit hash.
 */
export interface RecipePersistDeps {
  readonly writer: RowWriter;
  readonly provenance: ProvenanceWriter;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly source_file_name: string | null;
  readonly source_sheet: string | null;
}

export type RecipePersistFn = (
  rows: ReadonlyArray<Row>,
  approved_schema: AppliedSchema,
) => Promise<PersistResult>;

/**
 * Build the `persist` closure for a recipe.
 *
 * @param recipe_id  recipe identifier — surfaced in the fail-closed
 *                   error so an operator knows which recipe was invoked
 *                   without a writer.
 * @param deps       runtime persistence ports, or `undefined` for the
 *                   default singleton (fail-closed).
 */
export function buildPersistFn(
  recipe_id: string,
  deps?: RecipePersistDeps,
): RecipePersistFn {
  if (deps === undefined) {
    return async () => {
      throw new DataOnboardingError(
        'persist_conflict',
        `recipe ${recipe_id} has no RowWriter bound — construct it via its ` +
          `create*OnboardingRecipe(deps) factory before calling persist(). ` +
          `The default singleton fails closed and never fabricates rows.`,
      );
    };
  }

  return async (
    rows: ReadonlyArray<Row>,
    approved_schema: AppliedSchema,
  ): Promise<PersistResult> =>
    persistRows({
      rows,
      approved_schema,
      writer: deps.writer,
      provenance: deps.provenance,
      session_id: deps.session_id,
      tenant_id: deps.tenant_id,
      source_file_name: deps.source_file_name,
      source_sheet: deps.source_sheet,
    });
}
