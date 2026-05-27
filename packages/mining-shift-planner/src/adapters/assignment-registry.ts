/**
 * Adapter — bridges `@borjie/assignment-registry` to the local
 * `AssignmentSinkPort` contract used by the planner.
 *
 * Why a dedicated client interface?
 *   The upstream registry models RBAC-style scope assignments
 *   (user → capability → scopeRef). Shift assignments are a related
 *   but distinct concept (worker → task → equipment → time-window).
 *   We therefore depend on a `ShiftRegistryClient` indirection that
 *   composition roots wire up — wiring may either:
 *     a) call the registry's `LifecycleManager.bulkAssign(...)` directly,
 *        translating each ShiftAssignment into an AssignUserRequest, OR
 *     b) write to a dedicated shift-assignments table behind the same
 *        package.
 *
 *   Both options are HONEST. This adapter does NOT silently no-op; if
 *   no client is provided OR the client lacks `publishShiftAssignments`,
 *   the adapter throws on first call so pilots see a loud error in logs
 *   rather than think their assignments were saved.
 */

import type {
  AssignmentSinkPort,
  Logger,
} from '../ports.js';
import { NOOP_LOGGER } from '../ports.js';
import type { ShiftAssignment } from '../types.js';

/**
 * Minimal contract a shift-aware client must satisfy. Composition roots
 * wire concrete implementations (Drizzle, in-memory, REST) behind this.
 */
export interface ShiftRegistryClient {
  publishShiftAssignments?(args: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly assignments: ReadonlyArray<ShiftAssignment>;
  }): Promise<{ readonly publishedCount: number }>;
}

export interface CreateAssignmentRegistrySinkArgs {
  /**
   * Concrete client wired by the composition root. If omitted, the
   * adapter throws on every `publishAssignments` call — by design;
   * silent no-ops in shift management cost lives.
   */
  readonly registryClient?: ShiftRegistryClient;
  /** Optional structured logger. Defaults to a no-op. */
  readonly logger?: Logger;
}

/**
 * Build an `AssignmentSinkPort` backed by an
 * `@borjie/assignment-registry`-flavoured client.
 *
 * The adapter is always constructable so the planner can be wired in
 * composition roots that have not yet finished provisioning the
 * registry. The first call to `publishAssignments` will fail loudly if
 * the client is missing or lacks `publishShiftAssignments`.
 */
export function createAssignmentRegistrySink(
  args: CreateAssignmentRegistrySinkArgs = {},
): AssignmentSinkPort {
  const logger = args.logger ?? NOOP_LOGGER;
  return {
    async publishAssignments({ tenantId, siteId, assignments }) {
      if (!args.registryClient) {
        logger.error('mining-shift-planner.assignment-registry.no-client', {
          tenantId,
          siteId,
          attemptedCount: assignments.length,
        });
        throw new Error(
          'createAssignmentRegistrySink: registryClient not provided. ' +
            'Wire a ShiftRegistryClient with `publishShiftAssignments` ' +
            'in the composition root before calling publishAssignments.',
        );
      }
      if (typeof args.registryClient.publishShiftAssignments !== 'function') {
        logger.error(
          'mining-shift-planner.assignment-registry.missing-method',
          {
            tenantId,
            siteId,
            method: 'publishShiftAssignments',
            attemptedCount: assignments.length,
          },
        );
        throw new Error(
          'createAssignmentRegistrySink: registryClient is missing the ' +
            '`publishShiftAssignments` method. Upgrade the client (see ' +
            'ShiftRegistryClient in ' +
            '@borjie/mining-shift-planner/adapters/assignment-registry).',
        );
      }
      logger.info('mining-shift-planner.assignment-registry.publish.start', {
        tenantId,
        siteId,
        count: assignments.length,
      });
      const result = await args.registryClient.publishShiftAssignments({
        tenantId,
        siteId,
        assignments,
      });
      logger.info('mining-shift-planner.assignment-registry.publish.done', {
        tenantId,
        siteId,
        publishedCount: result.publishedCount,
      });
      return { publishedCount: result.publishedCount };
    },
  };
}
