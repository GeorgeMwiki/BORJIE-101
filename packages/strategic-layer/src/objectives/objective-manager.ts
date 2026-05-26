/**
 * `ObjectiveManager` — north-star objective CRUD + status transitions.
 *
 * Implements the state machine documented in
 * `STRATEGIC_DIRECTION_LAYER_SPEC.md` §15.1:
 *
 *   proposed ──activate──▶ active
 *   proposed ──reject  ──▶ retired
 *   active   ──met     ──▶ met
 *   active   ──miss    ──▶ missed
 *   active   ──retire  ──▶ retired
 *
 * T2 transitions (activate, retire) carry an audit-chained row update.
 * The caller is responsible for routing T2 events through
 * `@borjie/mutation-authority` — this manager is the *substrate*, not
 * the gate.
 */

import { randomUUID } from 'node:crypto';
import {
  type CreateNorthStarInput,
  type NorthStar,
  type NorthStarObjectivesRepository,
  type ObjectiveStatus,
  InvalidStateTransition,
} from '../types.js';
import {
  computeStrategicAuditHash,
  GENESIS_HASH,
} from '../audit/audit-chain-link.js';

export interface ObjectiveManagerDeps {
  readonly repo: NorthStarObjectivesRepository;
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export interface ObjectiveManager {
  create(input: CreateNorthStarInput): Promise<NorthStar>;
  activate(tenantId: string, id: string): Promise<NorthStar>;
  retire(tenantId: string, id: string): Promise<NorthStar>;
  markMet(tenantId: string, id: string): Promise<NorthStar>;
  markMissed(tenantId: string, id: string): Promise<NorthStar>;
  get(tenantId: string, id: string): Promise<NorthStar | null>;
  listActive(tenantId: string): Promise<ReadonlyArray<NorthStar>>;
}

// Allowed transitions: { current: allowedNext[] }.
const ALLOWED_TRANSITIONS: Readonly<Record<ObjectiveStatus, ReadonlyArray<ObjectiveStatus>>> = {
  proposed: ['active', 'retired'],
  active: ['met', 'missed', 'retired'],
  met: [],
  missed: [],
  retired: [],
};

export function createObjectiveManager(
  deps: ObjectiveManagerDeps,
): ObjectiveManager {
  const { repo, now } = deps;

  const transition = async (
    tenantId: string,
    id: string,
    nextStatus: ObjectiveStatus,
  ): Promise<NorthStar> => {
    const current = await repo.findById(tenantId, id);
    if (current === null) {
      throw new InvalidStateTransition('absent', nextStatus);
    }
    const allowedNext = ALLOWED_TRANSITIONS[current.status];
    if (!allowedNext.includes(nextStatus)) {
      throw new InvalidStateTransition(current.status, nextStatus);
    }
    const updatedAt = now().toISOString();
    const prevHash = current.auditHash;
    const auditHash = computeStrategicAuditHash(
      {
        op: 'transition',
        id,
        tenantId,
        from: current.status,
        to: nextStatus,
        at: updatedAt,
      },
      prevHash,
    );
    return repo.updateStatus(
      tenantId,
      id,
      nextStatus,
      updatedAt,
      auditHash,
      prevHash,
    );
  };

  return {
    async create(input: CreateNorthStarInput): Promise<NorthStar> {
      const id = randomUUID();
      const createdAt = now().toISOString();
      const auditHash = computeStrategicAuditHash(
        {
          op: 'create',
          id,
          tenantId: input.tenantId,
          title: input.title,
          metricName: input.metricName,
          targetValue: input.targetValue,
          targetAt: input.targetAt,
          ownerUserId: input.ownerUserId,
          at: createdAt,
        },
        GENESIS_HASH,
      );
      const row: NorthStar = Object.freeze({
        id,
        tenantId: input.tenantId,
        scopeId: input.scopeId,
        title: input.title,
        description: input.description,
        metricName: input.metricName,
        targetValue: input.targetValue,
        targetAt: input.targetAt,
        status: 'proposed' as ObjectiveStatus,
        ownerUserId: input.ownerUserId,
        createdAt,
        updatedAt: createdAt,
        auditHash,
        prevHash: null,
      });
      return repo.insert(row);
    },

    activate(tenantId, id): Promise<NorthStar> {
      return transition(tenantId, id, 'active');
    },

    retire(tenantId, id): Promise<NorthStar> {
      return transition(tenantId, id, 'retired');
    },

    markMet(tenantId, id): Promise<NorthStar> {
      return transition(tenantId, id, 'met');
    },

    markMissed(tenantId, id): Promise<NorthStar> {
      return transition(tenantId, id, 'missed');
    },

    get(tenantId, id): Promise<NorthStar | null> {
      return repo.findById(tenantId, id);
    },

    listActive(tenantId): Promise<ReadonlyArray<NorthStar>> {
      return repo.listActive(tenantId);
    },
  };
}
