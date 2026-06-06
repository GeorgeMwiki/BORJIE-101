/**
 * /api/v1/mining/onboarding — new-user ONBOARDING BOOTSTRAP.
 *
 * Turns an owner's first data drop (a CSV the chat normalised into a
 * `TabularSample`, OR an uploaded DOCUMENT already run through OCR into
 * `ocr_extractions`) into REAL rows in the tenant's domain tables —
 * `employees`, `sites`, `licences` — through the `@borjie/data-
 * onboarding` recipe pipeline.
 *
 * Two-step, confirm-before-write contract:
 *
 *   POST /mining/onboarding/ingest
 *     Body: { sample } | { ocr_extraction_id }  (+ optional entity_hint)
 *     → recognise entity type → discover schema → match against the
 *       canonical onboarding target → propose schema evolution +
 *       profile-chain graph. Writes NOTHING. Returns the proposal the
 *       owner confirms.
 *
 *   POST /mining/onboarding/commit
 *     Body: { sample } | { ocr_extraction_id }, entity_type,
 *            optional company_id / licence_id overrides.
 *     → opens ONE tenant-scoped transaction (tx-local
 *       `app.current_tenant_id` GUC so RLS fires), creates the
 *       `data_onboarding_sessions` row, runs the recipe with the
 *       Drizzle `RowWriter` → REAL idempotent inserts + hash-chained
 *       `ai_audit_chain` audit + `data_onboarding_row_provenance`.
 *
 * Hard rules: tenant-scoped + RLS GUC-bound on every write; idempotent
 * (natural key — re-ingest is a no-op); audit append-only hash-chained;
 * NO money writes; zod-validated; Pino logger only.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  recognizeEntityType,
  ocrExtractionToTabularSample,
  createWorkerOnboardingRecipe,
  createParcelOnboardingRecipe,
  matchColumns,
  findJoinCandidates,
  buildProposals,
  buildChainGraph,
  ENTITY_CONFIDENCE_FLOOR,
  type TabularSample,
  type TenantSchemaCtx,
  type TenantTable,
  type EntityType,
  type AppliedSchema,
  type SchemaMatchResult,
  type Row,
  type DataOnboardingRecipe,
  type RecipePersistDeps,
} from '@borjie/data-onboarding';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { logger } from '../../utils/logger';
import {
  createDrizzleOnboardingWriters,
  isSupportedOnboardingTable,
  type OnboardingTxClient,
  type OnboardingWriterCtx,
} from '../../composition/onboarding/drizzle-row-writer';
// FLOW-2 stepped orchestrator (start / advance / complete) — registered onto
// this same router so the wizard's three verbs share the `/onboarding` mount.
// Kept in a sibling file so this route stays under the 800-line budget.
import { registerOnboardingFlowRoutes } from './onboarding-flow.hono';

// ---------------------------------------------------------------------------
// Canonical onboarding targets — LOGICAL schema per supported entity.
//
// The recipe pipeline matches incoming columns against these logical
// tenant columns; the Drizzle RowWriter then translates the logical
// target table (`workers` / `sites` / `mining_licences`) onto the
// physical Borjie table (`employees` / `sites` / `licences`). Keeping
// the logical target here means the package stays physical-schema
// agnostic and its unit tests stay green.
// ---------------------------------------------------------------------------

const LOGICAL_TARGETS: Readonly<Record<string, TenantTable>> = Object.freeze({
  worker: Object.freeze({
    schema: 'public',
    table: 'workers',
    entity_type_hint: 'worker' as const,
    columns: Object.freeze([
      { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
      { name: 'nida', type: 'text', nullable: false, is_pk: false, is_unique: true },
      { name: 'name', type: 'text', nullable: false, is_pk: false, is_unique: false },
      { name: 'role', type: 'text', nullable: true, is_pk: false, is_unique: false },
    ]),
  }),
  site: Object.freeze({
    schema: 'public',
    table: 'sites',
    entity_type_hint: 'site' as const,
    columns: Object.freeze([
      { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
      { name: 'name', type: 'text', nullable: false, is_pk: false, is_unique: false },
      { name: 'mineral', type: 'text', nullable: false, is_pk: false, is_unique: false },
      { name: 'phase', type: 'text', nullable: true, is_pk: false, is_unique: false },
    ]),
  }),
  licence: Object.freeze({
    schema: 'public',
    table: 'mining_licences',
    entity_type_hint: 'licence' as const,
    columns: Object.freeze([
      { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
      { name: 'licence_no', type: 'text', nullable: false, is_pk: false, is_unique: true },
      { name: 'mineral', type: 'text', nullable: false, is_pk: false, is_unique: false },
      { name: 'kind', type: 'text', nullable: true, is_pk: false, is_unique: false },
    ]),
  }),
});

/** Natural-key logical field per entity (mirror of the writer binding). */
const NATURAL_KEY_FIELD: Readonly<Record<string, string>> = Object.freeze({
  worker: 'nida',
  site: 'name',
  licence: 'licence_no',
});

type SupportedEntity = 'worker' | 'site' | 'licence';

function isSupportedEntity(value: EntityType): value is SupportedEntity {
  return value === 'worker' || value === 'site' || value === 'licence';
}

function buildTenantCtx(
  tenantId: string,
  entity: SupportedEntity,
): TenantSchemaCtx {
  const target = LOGICAL_TARGETS[entity];
  return Object.freeze({
    tenant_id: tenantId,
    tables: Object.freeze(target !== undefined ? [target] : []),
  });
}

/**
 * Pick the live recipe for an entity, binding the persistence deps.
 *
 * Only the recipe's table-AGNOSTIC stages are consumed from here:
 * `discover` (sample → infer → recognise) and `persist` (the wired
 * RowWriter path). The table-SPECIFIC `match` / `build_chain` are run
 * route-side via {@link runMatch} / {@link runChain} against
 * {@link LOGICAL_TARGETS} so site / licence feeds (which the bundled
 * recipe `match` does not target) are handled uniformly. The worker
 * recipe matches `workers`; the parcel recipe lends its identical
 * discover/persist shape to site + licence.
 */
function recipeFor(
  entity: SupportedEntity,
  deps?: RecipePersistDeps,
): DataOnboardingRecipe {
  if (entity === 'worker') return createWorkerOnboardingRecipe(deps);
  // site + licence reuse the parcel recipe's discover/persist shape; the
  // approved schema (built route-side) pins the real logical target.
  return createParcelOnboardingRecipe(deps);
}

/** Run column matching route-side against the canonical logical target. */
function runMatch(
  discovered_columns: Parameters<typeof matchColumns>[0],
  entity: SupportedEntity,
  ctx: TenantSchemaCtx,
): SchemaMatchResult {
  const target = LOGICAL_TARGETS[entity];
  if (target === undefined) {
    throw new Error(`no logical target for entity ${entity}`);
  }
  const matched = matchColumns(discovered_columns, target);
  const joins = findJoinCandidates(discovered_columns, ctx.tables);
  return Object.freeze({
    target_table: Object.freeze({ schema: target.schema, table: target.table }),
    column_mappings: matched.mappings,
    unmatched_columns: matched.unmatched,
    join_keys_to_other_tables: joins,
  });
}

/** Build the profile-chain graph route-side rooted at the logical table. */
function runChain(entity: SupportedEntity, ctx: TenantSchemaCtx) {
  const target = LOGICAL_TARGETS[entity];
  return buildChainGraph({
    root_entity: entity,
    root_table: target?.table ?? entity,
    ctx,
  });
}

/**
 * Build the `AppliedSchema` the recipe persists against. The owner has
 * (implicitly, by calling /commit) approved the proposed mapping; this
 * pins the logical target table + primary key + the confirmed column
 * mappings so `persistRows` projects the right fields.
 */
function buildApprovedSchema(
  entity: SupportedEntity,
  mappings: AppliedSchema['column_mappings'],
): AppliedSchema {
  const target = LOGICAL_TARGETS[entity];
  if (target === undefined) {
    throw new Error(`no logical target for entity ${entity}`);
  }
  return Object.freeze({
    target_table: Object.freeze({ schema: target.schema, table: target.table }),
    column_mappings: mappings,
    primary_key_field: NATURAL_KEY_FIELD[entity] ?? 'id',
  });
}

// ---------------------------------------------------------------------------
// Request schemas (zod)
// ---------------------------------------------------------------------------

const tabularSampleSchema = z.object({
  source_file: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    sheet: z.string().optional(),
  }),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())),
  total_row_count: z.number().int().nonnegative(),
});

const ingestBodySchema = z
  .object({
    sample: tabularSampleSchema.optional(),
    ocr_extraction_id: z.string().min(1).optional(),
    entity_hint: z.string().min(1).optional(),
  })
  .refine((b) => b.sample !== undefined || b.ocr_extraction_id !== undefined, {
    message: 'provide either `sample` or `ocr_extraction_id`',
  });

const commitBodySchema = z
  .object({
    sample: tabularSampleSchema.optional(),
    ocr_extraction_id: z.string().min(1).optional(),
    entity_type: z.enum(['worker', 'site', 'licence']),
    company_id: z.string().min(1).optional(),
    licence_id: z.string().min(1).optional(),
  })
  .refine((b) => b.sample !== undefined || b.ocr_extraction_id !== undefined, {
    message: 'provide either `sample` or `ocr_extraction_id`',
  });

// ---------------------------------------------------------------------------
// OCR extraction loader (tenant-scoped) → TabularSample
// ---------------------------------------------------------------------------

interface OcrExtractionRow {
  readonly id: string;
  readonly extracted_fields: unknown;
  readonly document_name: string | null;
}

async function loadSampleFromExtraction(
  db: { execute(q: unknown): Promise<unknown> },
  tenantId: string,
  extractionId: string,
): Promise<TabularSample | null> {
  // Tenant-scoped read: the RLS GUC is already bound by the database
  // middleware, and the explicit `tenant_id =` predicate is the
  // belt-and-braces second layer.
  const result = await db.execute(
    sql`
      SELECT e.id AS id,
             e.extracted_fields AS extracted_fields,
             d.file_name AS document_name
      FROM ocr_extractions e
      LEFT JOIN document_uploads d ON d.id = e.document_upload_id
      WHERE e.id = ${extractionId}
        AND e.tenant_id = ${tenantId}
      LIMIT 1
    `,
  );
  const rows = Array.isArray(result)
    ? (result as ReadonlyArray<OcrExtractionRow>)
    : ((result as { rows?: ReadonlyArray<OcrExtractionRow> }).rows ?? []);
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return ocrExtractionToTabularSample({
    extraction_id: row.id,
    document_name: row.document_name ?? `ocr_extraction_${row.id}`,
    extracted_fields: row.extracted_fields,
  });
}

// ---------------------------------------------------------------------------
// Company / licence resolution (FK prerequisites)
// ---------------------------------------------------------------------------

async function resolveDefaultCompanyId(
  db: { execute(q: unknown): Promise<unknown> },
  tenantId: string,
  override: string | undefined,
): Promise<string | null> {
  if (override !== undefined) return override;
  const result = await db.execute(
    sql`
      SELECT id FROM companies
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );
  const rows = Array.isArray(result)
    ? (result as ReadonlyArray<{ id: string }>)
    : ((result as { rows?: ReadonlyArray<{ id: string }> }).rows ?? []);
  return rows.length > 0 ? rows[0]!.id : null;
}

async function resolveDefaultLicenceId(
  db: { execute(q: unknown): Promise<unknown> },
  tenantId: string,
  override: string | undefined,
): Promise<string | null> {
  if (override !== undefined) return override;
  const result = await db.execute(
    sql`
      SELECT id FROM licences
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );
  const rows = Array.isArray(result)
    ? (result as ReadonlyArray<{ id: string }>)
    : ((result as { rows?: ReadonlyArray<{ id: string }> }).rows ?? []);
  return rows.length > 0 ? rows[0]!.id : null;
}

// ---------------------------------------------------------------------------
// Sample → recipe Rows
// ---------------------------------------------------------------------------

function sampleToRows(sample: TabularSample): ReadonlyArray<Row> {
  return Object.freeze(
    sample.rows.map((cells, i) => {
      const values: Record<string, unknown> = {};
      sample.headers.forEach((header, idx) => {
        values[header] = cells[idx] ?? null;
      });
      return Object.freeze({
        source_row_number: i + 1,
        values: Object.freeze(values),
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

/**
 * POST /ingest — recognise + propose. Writes nothing.
 */
app.post('/ingest', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db') as
    | { execute(q: unknown): Promise<unknown> }
    | null;
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: { code: 'LIVE_DATA_NOT_CONFIGURED', message: 'Database unavailable.' },
      },
      503,
    );
  }

  let body: z.infer<typeof ingestBodySchema>;
  try {
    body = ingestBodySchema.parse(await c.req.json());
  } catch (error) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', message: (error as Error).message },
      },
      400,
    );
  }

  const rawSample =
    body.sample ??
    (body.ocr_extraction_id !== undefined
      ? await loadSampleFromExtraction(db, tenantId, body.ocr_extraction_id)
      : null);
  // Normalize to a strict TabularSample (exactOptionalPropertyTypes: omit
  // `sheet` when undefined rather than setting it).
  const sample: TabularSample | null =
    rawSample === null
      ? null
      : {
          source_file: {
            id: rawSample.source_file.id,
            name: rawSample.source_file.name,
            ...(rawSample.source_file.sheet !== undefined
              ? { sheet: rawSample.source_file.sheet }
              : {}),
          },
          headers: rawSample.headers,
          rows: rawSample.rows,
          total_row_count: rawSample.total_row_count,
        };

  if (sample === null) {
    return c.json(
      {
        success: false as const,
        error: { code: 'EXTRACTION_NOT_FOUND', message: 'OCR extraction not found for tenant.' },
      },
      404,
    );
  }

  const recognition = recognizeEntityType(sample, body.entity_hint);

  if (!isSupportedEntity(recognition.inferred_entity_type)) {
    return c.json(
      {
        success: true as const,
        data: {
          recognized_entity: recognition.inferred_entity_type,
          entity_confidence: recognition.entity_confidence,
          above_floor: recognition.entity_confidence >= ENTITY_CONFIDENCE_FLOOR,
          supported: false as const,
          proposal: null,
          message:
            `entity "${recognition.inferred_entity_type}" is recognised but ` +
            `onboarding bootstrap currently persists worker / site / licence feeds`,
        },
      },
      200,
    );
  }

  const entity = recognition.inferred_entity_type;
  const ctx = buildTenantCtx(tenantId, entity);
  const recipe = recipeFor(entity);

  try {
    const discovered = await recipe.discover(sample);
    const match = runMatch(discovered.columns, entity, ctx);
    const proposals = buildProposals({
      match,
      highest_existing_migration: 22,
      migration_slug: `${entity}_onboarding_evolution`,
      research_evidence_ids: Object.freeze([]),
    });
    const chain = runChain(entity, ctx);

    return c.json(
      {
        success: true as const,
        data: {
          recognized_entity: entity,
          entity_confidence: recognition.entity_confidence,
          above_floor: recognition.entity_confidence >= ENTITY_CONFIDENCE_FLOOR,
          supported: true as const,
          target_table: LOGICAL_TARGETS[entity]?.table ?? null,
          row_count: sample.total_row_count,
          discovered_schema: discovered,
          schema_match: match,
          evolution_proposals: proposals,
          profile_chain: chain,
          natural_key_field: NATURAL_KEY_FIELD[entity],
        },
      },
      200,
    );
  } catch (error) {
    logger.error(
      { err: error, tenantId, entity },
      'onboarding ingest failed',
    );
    return c.json(
      {
        success: false as const,
        error: { code: 'INGEST_FAILED', message: 'Could not analyse the feed.' },
      },
      500,
    );
  }
});

/**
 * POST /commit — run the recipe with the real RowWriter → REAL rows.
 */
app.post('/commit', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db') as
    | {
        execute(q: unknown): Promise<unknown>;
        transaction<T>(cb: (tx: OnboardingTxClient) => Promise<T>): Promise<T>;
      }
    | null;
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: { code: 'LIVE_DATA_NOT_CONFIGURED', message: 'Database unavailable.' },
      },
      503,
    );
  }

  let body: z.infer<typeof commitBodySchema>;
  try {
    body = commitBodySchema.parse(await c.req.json());
  } catch (error) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', message: (error as Error).message },
      },
      400,
    );
  }

  const entity = body.entity_type;
  const target = LOGICAL_TARGETS[entity];
  if (target === undefined || !isSupportedOnboardingTable(target.table)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNSUPPORTED_ENTITY', message: `entity ${entity} cannot be persisted` },
      },
      400,
    );
  }

  const rawSample =
    body.sample ??
    (body.ocr_extraction_id !== undefined
      ? await loadSampleFromExtraction(db, tenantId, body.ocr_extraction_id)
      : null);
  // Normalize to a strict TabularSample: under exactOptionalPropertyTypes the
  // zod-inferred `sheet?: string | undefined` must be OMITTED (not set to
  // undefined) to satisfy `sheet?: string`. Mirrors the OCR bridge pattern.
  const sample: TabularSample | null =
    rawSample === null
      ? null
      : {
          source_file: {
            id: rawSample.source_file.id,
            name: rawSample.source_file.name,
            ...(rawSample.source_file.sheet !== undefined
              ? { sheet: rawSample.source_file.sheet }
              : {}),
          },
          headers: rawSample.headers,
          rows: rawSample.rows,
          total_row_count: rawSample.total_row_count,
        };
  if (sample === null) {
    return c.json(
      {
        success: false as const,
        error: { code: 'EXTRACTION_NOT_FOUND', message: 'OCR extraction not found for tenant.' },
      },
      404,
    );
  }

  // Resolve FK prerequisites (tenant-scoped) before opening the tx.
  const [defaultCompanyId, defaultLicenceId] = await Promise.all([
    resolveDefaultCompanyId(db, tenantId, body.company_id),
    entity === 'site'
      ? resolveDefaultLicenceId(db, tenantId, body.licence_id)
      : Promise.resolve<string | null>(null),
  ]);

  // Compute the approved schema once (discover → match drives the
  // confirmed column mappings).
  const ctx = buildTenantCtx(tenantId, entity);
  const baseRecipe = recipeFor(entity);
  const discovered = await baseRecipe.discover(sample);
  const match = runMatch(discovered.columns, entity, ctx);
  const approvedSchema = buildApprovedSchema(entity, match.column_mappings);
  const rows = sampleToRows(sample);
  const sessionId = randomUUID();
  const attachmentId =
    body.ocr_extraction_id !== undefined ? body.ocr_extraction_id : randomUUID();

  try {
    const result = await db.transaction(async (tx) => {
      // Bind the tenant GUC TRANSACTION-LOCALLY as the FIRST statement so
      // RLS fires on a pooled connection the request middleware never
      // touched. `true` scopes it to this tx (no cross-request leak).
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
      );

      // Create the onboarding session row FIRST — provenance rows carry a
      // FK to it (ON DELETE CASCADE).
      await tx.execute(
        sql`
          INSERT INTO data_onboarding_sessions (
            id, tenant_id, user_id, attachment_id, inferred_entity_type,
            entity_confidence, status, discovered_schema, schema_match_result,
            started_at
          ) VALUES (
            ${sessionId},
            ${tenantId},
            ${userId},
            ${attachmentId},
            ${entity},
            ${String(discovered.entity_confidence)},
            ${'persisting'},
            ${JSON.stringify(discovered)}::jsonb,
            ${JSON.stringify(match)}::jsonb,
            ${new Date().toISOString()}
          )
        `,
      );

      const writerCtx: OnboardingWriterCtx = Object.freeze({
        tx,
        tenantId,
        userId,
        sessionId,
        defaultCompanyId,
        defaultLicenceId,
      });
      const { writer, provenance } = createDrizzleOnboardingWriters(writerCtx);
      const deps: RecipePersistDeps = Object.freeze({
        writer,
        provenance,
        session_id: sessionId,
        tenant_id: tenantId,
        source_file_name: sample.source_file.name,
        source_sheet: sample.source_file.sheet ?? null,
      });

      const recipe = recipeFor(entity, deps);
      const persistResult = await recipe.persist(rows, approvedSchema);

      // Seal the session.
      await tx.execute(
        sql`
          UPDATE data_onboarding_sessions
          SET status = ${'complete'},
              persist_result = ${JSON.stringify(persistResult)}::jsonb,
              completed_at = ${new Date().toISOString()}
          WHERE id = ${sessionId}
            AND tenant_id = ${tenantId}
        `,
      );

      return persistResult;
    });

    logger.info(
      {
        tenantId,
        entity,
        sessionId,
        rowsInserted: result.rows_inserted,
        rowsSkipped: result.rows_skipped,
      },
      'onboarding commit persisted',
    );

    return c.json(
      {
        success: true as const,
        data: {
          session_id: sessionId,
          entity_type: entity,
          target_table: result.target_table,
          rows_inserted: result.rows_inserted,
          rows_updated: result.rows_updated,
          rows_skipped: result.rows_skipped,
          persisted_rows: result.persisted_rows,
          audit_hash: result.audit_hash,
        },
      },
      201,
    );
  } catch (error) {
    logger.error(
      { err: error, tenantId, entity, sessionId },
      'onboarding commit failed',
    );
    return c.json(
      {
        success: false as const,
        error: { code: 'COMMIT_FAILED', message: 'Could not persist the feed.' },
      },
      500,
    );
  }
});

// FLOW-2 — register the stepped orchestrator (start / advance / complete)
// onto this same router so the wizard's three verbs share the `/onboarding`
// mount. Implementation lives in onboarding-flow.hono.ts (800-line budget).
registerOnboardingFlowRoutes(app);

export const miningOnboardingRouter = app;

// Test seam — exported pure helpers so unit tests can exercise the
// recognise → approved-schema → rows path without a live Postgres.
export const __TEST_ONLY = Object.freeze({
  buildTenantCtx,
  buildApprovedSchema,
  sampleToRows,
  recipeFor,
  LOGICAL_TARGETS,
  NATURAL_KEY_FIELD,
});
