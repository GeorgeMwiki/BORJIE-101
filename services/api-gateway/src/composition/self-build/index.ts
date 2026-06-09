/**
 * @file self-build composition root — the gap-to-module orchestrator that
 * composes the EXISTING engines into the operator-gated self-BUILDING loop.
 *
 * It wires:
 *   - `@borjie/module-spec-engine`        (validate / compile / dry-run)
 *   - `@borjie/module-orchestrator`       (canonical FORCE-RLS gate helpers)
 *   - the migration-0323 registry         (modules + module_specs) as the
 *                                          PROPOSAL store
 *
 * `createSelfBuildWiring({ db, logger })` returns a `SelfBuildOrchestrator` the
 * route mounts behind a SUPER_ADMIN + four-eye gate. Propose-only: nothing on
 * this path applies a migration to the running system.
 */

import { randomUUID } from 'node:crypto';
import {
  createPinoLikeLogger,
  type PinoLikeLogger,
} from '../../utils/pino-shim.js';
import type { DatabaseClient } from '../module-spawning/shared.js';
import { createSelfBuildProposalStore } from './proposal-store.js';
import { createSelfBuildOrchestrator } from './orchestrator.js';
import type {
  SelfBuildOrchestrator,
  SelfBuildIdGen,
} from './orchestrator.js';

export type {
  RecordedGap,
  DerivedModulePlan,
} from './gap-to-spec.js';
export {
  deriveModulePlanFromGap,
  deriveModuleSlug,
  toSlugFragment,
} from './gap-to-spec.js';
export type {
  SelfBuildProposalStore,
  ProposalSummary,
  ProposalDetail,
  PersistProposalArgs,
} from './proposal-store.js';
export {
  createSelfBuildProposalStore,
  PROPOSAL_SPEC_STATUS,
  PROPOSAL_MODULE_STATE,
  APPROVED_MODULE_STATE,
} from './proposal-store.js';
export type {
  SelfBuildOrchestrator,
  SelfBuildOrchestratorDeps,
  SelfBuildIdGen,
  DriveGapInput,
  DriveGapResult,
} from './orchestrator.js';
// Re-export the imported value binding (avoids a redundant re-export-from).
export { createSelfBuildOrchestrator };

/** Crypto id-gen with a stable prefix — never a non-crypto pseudo source. */
export function createSelfBuildIdGen(): SelfBuildIdGen {
  return {
    newId(prefix) {
      return `${prefix}_${randomUUID()}`;
    },
  };
}

export interface CreateSelfBuildWiringArgs {
  readonly db: DatabaseClient;
  readonly logger?: PinoLikeLogger;
}

/**
 * Compose the real `SelfBuildOrchestrator` over Drizzle + the existing
 * spec/orchestrator engines. Honest-degrade by construction: every store
 * method catches + logs; the orchestrator returns structured failures.
 */
export function createSelfBuildWiring(
  args: CreateSelfBuildWiringArgs,
): SelfBuildOrchestrator {
  const logger = args.logger ?? createPinoLikeLogger('self-build');
  const store = createSelfBuildProposalStore(args.db, logger);
  return createSelfBuildOrchestrator({
    store,
    ids: createSelfBuildIdGen(),
    logger,
  });
}
