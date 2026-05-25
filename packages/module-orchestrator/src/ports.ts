/**
 * Ports the orchestrator depends on. The api-gateway composition root
 * wires real implementations; tests inject fakes.
 *
 * Each port is small and side-effecting; the orchestrator core stays
 * pure functions that combine them.
 */

import type { ModuleLifecycleState } from './lifecycle.js';

export interface ModulesStorePort {
  /** Create a `modules` row. Returns the new id. */
  createModule(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly slug: string;
    readonly title: string;
    readonly titleSw: string | null;
    readonly templateId: string | null;
    readonly vectorNamespace: string;
    readonly scopedToolIds: readonly string[];
    readonly createdByUserId: string | null;
  }): Promise<{ readonly id: string }>;

  /** Fetch a module by id (returns null if missing or wrong tenant). */
  findModule(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<ModuleRowSummary | null>;

  /** List modules for a tenant. */
  listModules(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<ModuleRowSummary>>;

  /** Transition a module's lifecycle_state (caller already validated). */
  setLifecycleState(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly state: ModuleLifecycleState;
    readonly specId: string | null;
  }): Promise<void>;
}

export interface ModuleRowSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly templateId: string | null;
  readonly specId: string | null;
  readonly lifecycleState: ModuleLifecycleState;
  readonly vectorNamespace: string;
}

export interface ModuleSpecsStorePort {
  /** Persist a compiled spec row. Returns the new id. */
  createSpec(args: {
    readonly id: string;
    readonly moduleId: string;
    readonly tenantId: string;
    readonly version: number;
    readonly specJsonb: Readonly<Record<string, unknown>>;
    readonly generatedMigrationSql: string;
    readonly generatedZodValidators: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;

  /** Look up the current spec for a module. */
  findSpec(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<{ readonly id: string; readonly migrationSql: string } | null>;

  /** Mark a spec applied. */
  markApplied(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly appliedMigrationFilename: string;
  }): Promise<void>;

  /** Mark a spec failed (records the error). */
  markFailed(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly error: string;
  }): Promise<void>;
}

export interface ModuleTemplatesStorePort {
  /** Look up a template bundle by slug. Returns null when missing. */
  findTemplate(slug: string): Promise<{
    readonly id: string;
    readonly slug: string;
    readonly defaultSpec: Readonly<Record<string, unknown>>;
  } | null>;

  /** List available templates. */
  listTemplates(): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly slug: string;
      readonly titleEn: string;
      readonly titleSw: string | null;
    }>
  >;
}

export interface MigrationApplyPort {
  /**
   * Execute the generated migration SQL inside the tenant connection
   * context. The implementation guarantees:
   *   * SET LOCAL app.current_tenant_id = '<tenantId>' is bound first
   *   * The whole apply runs in a single transaction
   *   * Failure rolls back ALL emitted statements
   *
   * Returns the on-disk filename the runner wrote the migration to
   * under `packages/database/src/migrations/tenant-modules/{tenantId}/`.
   */
  applyMigration(args: {
    readonly tenantId: string;
    readonly moduleId: string;
    readonly migrationSql: string;
  }): Promise<{ readonly appliedMigrationFilename: string }>;
}

export interface ApprovalPort {
  /**
   * Verify a four-eye approval exists for `{moduleId, specId}`.
   * Returns the approval id when present, null otherwise.
   */
  resolveApproval(args: {
    readonly tenantId: string;
    readonly moduleId: string;
    readonly specId: string;
  }): Promise<{ readonly approvalId: string } | null>;
}

export interface IdGenPort {
  /** Generate a globally unique id with a stable prefix. */
  newId(prefix: 'mod' | 'mspec'): string;
}

export interface OrchestratorDeps {
  readonly modules: ModulesStorePort;
  readonly specs: ModuleSpecsStorePort;
  readonly templates: ModuleTemplatesStorePort;
  readonly migrate: MigrationApplyPort;
  readonly approval: ApprovalPort;
  readonly ids: IdGenPort;
}
