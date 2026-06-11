/**
 * In-memory FlowAutonomyRepository — the no-DB fallback (tests /
 * DATABASE_URL unset). Mirrors the Drizzle adapter's contract so the
 * composition root can swap implementations behind one Port.
 *
 * Every returned record is a frozen immutable copy; the store is never
 * handed back by reference.
 */

import type {
  FlowAutonomyPosture,
  FlowAutonomyPref,
  FlowAutonomyRepository,
  RecordFlowCreationInput,
  SetFlowPostureInput,
} from './flow-autonomy-port.js';

function key(tenantId: string, flowId: string): string {
  return `${tenantId}::${flowId}`;
}

function freeze(pref: FlowAutonomyPref): FlowAutonomyPref {
  return Object.freeze({ ...pref });
}

export function createInMemoryFlowAutonomyRepository(
  now: () => Date = () => new Date(),
): FlowAutonomyRepository {
  const store = new Map<string, FlowAutonomyPref>();

  return {
    async recordFlowCreation(input: RecordFlowCreationInput) {
      const k = key(input.tenantId, input.flowId);
      const existing = store.get(k);
      // Idempotent: never reset an already-answered confirmation.
      if (existing) return freeze(existing);
      const t = now();
      const pref: FlowAutonomyPref = freeze({
        tenantId: input.tenantId,
        flowId: input.flowId,
        posture: 'gated',
        confirmationState: 'pending',
        riskCeiling: input.riskCeiling ?? null,
        amountThreshold: input.amountThreshold ?? null,
        createdBy: input.createdBy,
        promotedAt: null,
        createdAt: t,
        updatedAt: t,
      });
      store.set(k, pref);
      return pref;
    },

    async setPosture(input: SetFlowPostureInput) {
      const k = key(input.tenantId, input.flowId);
      const existing = store.get(k);
      const t = now();
      const posture: FlowAutonomyPosture = input.posture;
      const base: FlowAutonomyPref = existing ?? {
        tenantId: input.tenantId,
        flowId: input.flowId,
        posture: 'gated',
        confirmationState: 'pending',
        riskCeiling: null,
        amountThreshold: null,
        createdBy: input.actorUserId,
        promotedAt: null,
        createdAt: t,
        updatedAt: t,
      };
      const next: FlowAutonomyPref = freeze({
        ...base,
        posture,
        confirmationState: 'confirmed',
        riskCeiling:
          input.riskCeiling !== undefined
            ? input.riskCeiling
            : base.riskCeiling,
        amountThreshold:
          input.amountThreshold !== undefined
            ? input.amountThreshold
            : base.amountThreshold,
        promotedAt: posture === 'auto' ? base.promotedAt ?? t : null,
        updatedAt: t,
      });
      store.set(k, next);
      return next;
    },

    async get(tenantId: string, flowId: string) {
      const pref = store.get(key(tenantId, flowId));
      return pref ? freeze(pref) : null;
    },

    async list(tenantId: string) {
      return Object.freeze(
        [...store.values()]
          .filter((p) => p.tenantId === tenantId)
          .map(freeze),
      );
    },

    async listPending(tenantId: string) {
      return Object.freeze(
        [...store.values()]
          .filter(
            (p) =>
              p.tenantId === tenantId && p.confirmationState === 'pending',
          )
          .map(freeze),
      );
    },
  };
}
