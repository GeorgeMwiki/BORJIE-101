/**
 * SQL repository for `MetaLearningRun` + `Example`.
 *
 * Thin port: the package does not depend on `@borjie/database` types
 * directly. Production composition wires this onto Drizzle.
 *
 * The shape is exactly the migration's column shape.
 */

import type { Example, MetaLearningRun } from '../types.js';

/**
 * Database client port. Minimum surface needed.
 */
export interface SqlClientPort {
  readonly executeWithTenant: <T>(
    tenantId: string,
    fn: () => Promise<T>,
  ) => Promise<T>;
  readonly insertRunRow: (row: Readonly<RunInsertRow>) => Promise<void>;
  readonly updateRunRow: (row: Readonly<RunUpdateRow>) => Promise<void>;
  readonly fetchLatestRunRow: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<RunSelectRow | null>;
  readonly fetchRunsRows: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<ReadonlyArray<RunSelectRow>>;
  readonly insertExampleRows: (
    rows: ReadonlyArray<ExampleInsertRow>,
  ) => Promise<void>;
  readonly fetchExampleRows: (
    metaRunId: string,
  ) => Promise<ReadonlyArray<ExampleSelectRow>>;
}

export interface RunInsertRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly started_at: string;
  readonly status: string;
  readonly capability_id: string;
  readonly examples_count: number;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

export interface RunUpdateRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly ended_at: string;
  readonly status: string;
  readonly examples_count: number;
  readonly eval_metric_before: number | null;
  readonly eval_metric_after: number | null;
  readonly decision: string | null;
  readonly audit_hash: string;
}

export interface RunSelectRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly status: string;
  readonly capability_id: string;
  readonly examples_count: number;
  readonly eval_metric_before: number | null;
  readonly eval_metric_after: number | null;
  readonly decision: string | null;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

export interface ExampleInsertRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly meta_run_id: string;
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly reward: number;
  readonly included: boolean;
  readonly audit_hash: string;
}

export type ExampleSelectRow = ExampleInsertRow;

export function createSqlMetaLearningRepository(
  client: SqlClientPort,
): {
  readonly insertRun: (run: MetaLearningRun) => Promise<void>;
  readonly updateRun: (run: MetaLearningRun) => Promise<void>;
  readonly findLatestRun: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<MetaLearningRun | null>;
  readonly listRuns: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<ReadonlyArray<MetaLearningRun>>;
  readonly insertExamples: (
    examples: ReadonlyArray<Example>,
  ) => Promise<void>;
  readonly listExamples: (
    metaRunId: string,
  ) => Promise<ReadonlyArray<Example>>;
} {
  return Object.freeze({
    async insertRun(run: MetaLearningRun): Promise<void> {
      return client.executeWithTenant(run.tenantId, async () => {
        await client.insertRunRow({
          id: run.id,
          tenant_id: run.tenantId,
          started_at: run.startedAt,
          status: run.status,
          capability_id: run.capabilityId,
          examples_count: run.examplesCount,
          audit_hash: run.auditHash,
          prev_hash: run.prevHash,
        });
      });
    },

    async updateRun(run: MetaLearningRun): Promise<void> {
      if (run.endedAt === null) {
        throw new Error('updateRun requires endedAt to be set');
      }
      return client.executeWithTenant(run.tenantId, async () => {
        await client.updateRunRow({
          id: run.id,
          tenant_id: run.tenantId,
          ended_at: run.endedAt as string,
          status: run.status,
          examples_count: run.examplesCount,
          eval_metric_before: run.evalMetricBefore,
          eval_metric_after: run.evalMetricAfter,
          decision: run.decision,
          audit_hash: run.auditHash,
        });
      });
    },

    async findLatestRun(
      tenantId: string,
      capabilityId: string,
    ): Promise<MetaLearningRun | null> {
      return client.executeWithTenant(tenantId, async () => {
        const row = await client.fetchLatestRunRow(tenantId, capabilityId);
        if (!row) return null;
        return mapRowToRun(row);
      });
    },

    async listRuns(
      tenantId: string,
      capabilityId: string,
    ): Promise<ReadonlyArray<MetaLearningRun>> {
      return client.executeWithTenant(tenantId, async () => {
        const rows = await client.fetchRunsRows(tenantId, capabilityId);
        return rows.map(mapRowToRun);
      });
    },

    async insertExamples(examples: ReadonlyArray<Example>): Promise<void> {
      if (examples.length === 0) return;
      const first = examples[0];
      if (!first) return;
      const tenantId = first.tenantId;
      return client.executeWithTenant(tenantId, async () => {
        await client.insertExampleRows(
          examples.map((ex) => ({
            id: ex.id,
            tenant_id: ex.tenantId,
            meta_run_id: ex.metaRunId,
            prompt: ex.prompt,
            completion: ex.completion,
            reward: ex.reward,
            included: ex.included,
            audit_hash: ex.auditHash,
          })),
        );
      });
    },

    async listExamples(
      metaRunId: string,
    ): Promise<ReadonlyArray<Example>> {
      // Listing examples must be tenant-scoped at the caller; the row
      // itself carries tenant_id which we trust here.
      const rows = await client.fetchExampleRows(metaRunId);
      return rows.map(
        (row): Example => ({
          id: row.id,
          tenantId: row.tenant_id,
          metaRunId: row.meta_run_id,
          prompt: row.prompt,
          completion: row.completion,
          reward: row.reward,
          included: row.included,
          auditHash: row.audit_hash,
        }),
      );
    },
  });
}

function mapRowToRun(row: RunSelectRow): MetaLearningRun {
  const decision = parseDecision(row.decision);
  const status = parseStatus(row.status);
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status,
    capabilityId: row.capability_id,
    examplesCount: row.examples_count,
    evalMetricBefore: row.eval_metric_before,
    evalMetricAfter: row.eval_metric_after,
    decision,
    auditHash: row.audit_hash,
    prevHash: row.prev_hash,
  });
}

function parseDecision(
  raw: string | null,
): MetaLearningRun['decision'] {
  if (raw === null) return null;
  if (
    raw === 'promote' ||
    raw === 'demote' ||
    raw === 'no-op' ||
    raw === 'rollback'
  ) {
    return raw;
  }
  throw new Error(`Invalid decision in DB: ${raw}`);
}

function parseStatus(raw: string): MetaLearningRun['status'] {
  if (
    raw === 'scheduled' ||
    raw === 'running' ||
    raw === 'succeeded' ||
    raw === 'failed'
  ) {
    return raw;
  }
  throw new Error(`Invalid status in DB: ${raw}`);
}
