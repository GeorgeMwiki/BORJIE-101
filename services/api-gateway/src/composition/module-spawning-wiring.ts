/**
 * module-spawning-wiring.ts — Lane 3 (the crown jewel) of the
 * module-spawning Pass 2 composition root.
 *
 * Turns the `@borjie/module-orchestrator` ports (ModulesStorePort,
 * ModuleSpecsStorePort, ModuleTemplatesStorePort, MigrationApplyPort,
 * ApprovalPort, IdGenPort) into REAL Drizzle + transactional-DDL
 * implementations over the `modules` / `module_specs` / `module_templates`
 * registry tables (migration 0323) and the EXISTING four-eye
 * `sovereign_approvals` infrastructure.
 *
 * Public surface: `createModuleOrchestratorDeps({ db, logger, clock })`
 * returns an `OrchestratorDeps`. This file does NOT mount any router into
 * `services/api-gateway/src/index.ts` — that is Pass 3.
 *
 * The security wall (re-asserted by the executor on every apply):
 *   HARD RULE 1 — DDL allowlist (validateGeneratedDdl)
 *   HARD RULE 2 — per-table canonical FORCE-RLS coverage
 *   HARD RULE 3 — four-eye / K5 gate (assertApplyApproved)
 * The stored spec SQL is NEVER trusted — it is re-validated + re-gated
 * before a single statement reaches Postgres, inside a tenant-GUC-bound
 * single transaction (transactional DDL ⇒ all-or-nothing).
 *
 * Immutable; comprehensive try/catch; Pino-shape logger only (no
 * `console.*`); files small + functions short.
 */

import { randomUUID } from 'node:crypto';
import type { OrchestratorDeps, IdGenPort } from '@borjie/module-orchestrator';
import {
  createPinoLikeLogger,
  type PinoLikeLogger,
} from '../utils/pino-shim.js';
import {
  createModulesStore,
  createModuleSpecsStore,
  createModuleTemplatesStore,
} from './module-spawning/stores.js';
import { createApprovalPort } from './module-spawning/approval.js';
import { createMigrationExecutor } from './module-spawning/executor.js';
import { createFsArtifactWriter } from './module-spawning/artifact-writer.js';
import type {
  DatabaseClient,
  ModuleSpawnClock,
  MigrationArtifactWriter,
} from './module-spawning/shared.js';

export type {
  DatabaseClient,
  ModuleSpawnClock,
  MigrationArtifactWriter,
} from './module-spawning/shared.js';
export { createMigrationExecutor } from './module-spawning/executor.js';
export {
  createModulesStore,
  createModuleSpecsStore,
  createModuleTemplatesStore,
} from './module-spawning/stores.js';
export {
  createApprovalPort,
  fetchApprovalView,
} from './module-spawning/approval.js';

export interface CreateModuleOrchestratorDepsArgs {
  readonly db: DatabaseClient;
  /** Pino-shape logger; defaults to the project structured logger. */
  readonly logger?: PinoLikeLogger;
  /** Monotonic clock for the on-disk artifact filename; defaults to wall-clock. */
  readonly clock?: ModuleSpawnClock;
  /**
   * Artifact writer override. Defaults to the real fs writer. Tests inject
   * a recording fake so the real filesystem is never touched.
   */
  readonly artifactWriter?: MigrationArtifactWriter;
}

/** The default wall-clock used when no clock is injected. */
const systemClock: ModuleSpawnClock = { now: () => new Date() };

/**
 * IdGenPort — cryptographic UUID with a stable prefix. NEVER a non-crypto
 * pseudo-random source (no `Math.random`).
 */
export function createIdGenPort(): IdGenPort {
  return {
    newId(prefix) {
      return `${prefix}_${randomUUID()}`;
    },
  };
}

/**
 * Compose the real `OrchestratorDeps` over Drizzle + the transactional
 * DDL executor. Every port is tenant-scoped by construction; the executor
 * re-validates + re-gates the stored spec before applying.
 */
export function createModuleOrchestratorDeps(
  args: CreateModuleOrchestratorDepsArgs,
): OrchestratorDeps {
  const logger = args.logger ?? createPinoLikeLogger('module-spawning');
  const clock = args.clock ?? systemClock;
  const artifactWriter = args.artifactWriter ?? createFsArtifactWriter();

  return {
    modules: createModulesStore(args.db, logger),
    specs: createModuleSpecsStore(args.db, logger),
    templates: createModuleTemplatesStore(args.db, logger),
    approval: createApprovalPort(args.db, logger),
    ids: createIdGenPort(),
    migrate: createMigrationExecutor({ db: args.db, logger, clock, artifactWriter }),
  };
}
