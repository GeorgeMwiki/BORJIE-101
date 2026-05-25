/**
 * fakes.ts — in-memory fakes the orchestrator tests share.
 *
 * Every port has a faithful in-memory impl with a `state` exposing
 * what was written, so tests can assert effects without mocking.
 */

import type {
  OrchestratorDeps,
  ModuleRowSummary,
  ModulesStorePort,
  ModuleSpecsStorePort,
  ModuleTemplatesStorePort,
  MigrationApplyPort,
  ApprovalPort,
  IdGenPort,
} from '../ports.js';

export interface FakeState {
  readonly modules: Map<string, ModuleRowSummary>;
  readonly specs: Map<
    string,
    {
      id: string;
      moduleId: string;
      tenantId: string;
      version: number;
      migrationSql: string;
      compileStatus: 'pending' | 'compiled' | 'applied' | 'failed';
      compileError: string | null;
      appliedMigrationFilename: string | null;
    }
  >;
  readonly templates: Map<
    string,
    {
      id: string;
      slug: string;
      defaultSpec: Readonly<Record<string, unknown>>;
      titleEn: string;
      titleSw: string | null;
    }
  >;
  readonly approvals: Map<string, { approvalId: string }>;
  readonly appliedMigrations: { tenantId: string; moduleId: string; sql: string }[];
  nextIdCounter: number;
  /** Toggle to force MigrationApplyPort to throw. */
  shouldFailMigration: boolean;
}

export function makeFakeState(): FakeState {
  return {
    modules: new Map(),
    specs: new Map(),
    templates: new Map(),
    approvals: new Map(),
    appliedMigrations: [],
    nextIdCounter: 0,
    shouldFailMigration: false,
  };
}

export function makeFakeDeps(state: FakeState): OrchestratorDeps {
  const modules: ModulesStorePort = {
    async createModule(args) {
      state.modules.set(args.id, {
        id: args.id,
        tenantId: args.tenantId,
        slug: args.slug,
        title: args.title,
        titleSw: args.titleSw,
        templateId: args.templateId,
        specId: null,
        lifecycleState: 'DRAFT',
        vectorNamespace: args.vectorNamespace,
      });
      return { id: args.id };
    },
    async findModule({ tenantId, id }) {
      const row = state.modules.get(id);
      if (!row || row.tenantId !== tenantId) return null;
      return row;
    },
    async listModules({ tenantId }) {
      return Array.from(state.modules.values()).filter(
        (r) => r.tenantId === tenantId,
      );
    },
    async setLifecycleState({ tenantId, id, state: newState, specId }) {
      const row = state.modules.get(id);
      if (!row || row.tenantId !== tenantId) return;
      state.modules.set(id, {
        ...row,
        lifecycleState: newState,
        specId: specId ?? row.specId,
      });
    },
  };

  const specs: ModuleSpecsStorePort = {
    async createSpec(args) {
      state.specs.set(args.id, {
        id: args.id,
        moduleId: args.moduleId,
        tenantId: args.tenantId,
        version: args.version,
        migrationSql: args.generatedMigrationSql,
        compileStatus: 'compiled',
        compileError: null,
        appliedMigrationFilename: null,
      });
      return { id: args.id };
    },
    async findSpec({ tenantId, id }) {
      const row = state.specs.get(id);
      if (!row || row.tenantId !== tenantId) return null;
      return { id: row.id, migrationSql: row.migrationSql };
    },
    async markApplied({ id, appliedMigrationFilename }) {
      const row = state.specs.get(id);
      if (!row) return;
      state.specs.set(id, {
        ...row,
        compileStatus: 'applied',
        appliedMigrationFilename,
      });
    },
    async markFailed({ id, error }) {
      const row = state.specs.get(id);
      if (!row) return;
      state.specs.set(id, {
        ...row,
        compileStatus: 'failed',
        compileError: error,
      });
    },
  };

  const templates: ModuleTemplatesStorePort = {
    async findTemplate(slug) {
      return state.templates.get(slug) ?? null;
    },
    async listTemplates() {
      return Array.from(state.templates.values()).map((t) => ({
        id: t.id,
        slug: t.slug,
        titleEn: t.titleEn,
        titleSw: t.titleSw,
      }));
    },
  };

  const migrate: MigrationApplyPort = {
    async applyMigration(args) {
      if (state.shouldFailMigration) {
        throw new Error('synthetic migration failure');
      }
      state.appliedMigrations.push({
        tenantId: args.tenantId,
        moduleId: args.moduleId,
        sql: args.migrationSql,
      });
      return {
        appliedMigrationFilename: `T${args.tenantId}_${args.moduleId}.sql`,
      };
    },
  };

  const approval: ApprovalPort = {
    async resolveApproval({ moduleId, specId }) {
      return state.approvals.get(`${moduleId}:${specId}`) ?? null;
    },
  };

  const ids: IdGenPort = {
    newId(prefix) {
      state.nextIdCounter += 1;
      return `${prefix}_${String(state.nextIdCounter).padStart(4, '0')}`;
    },
  };

  return Object.freeze({
    modules,
    specs,
    templates,
    migrate,
    approval,
    ids,
  });
}
