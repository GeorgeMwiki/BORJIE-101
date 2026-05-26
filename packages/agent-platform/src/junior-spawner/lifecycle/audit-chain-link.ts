/**
 * Audit-chain link emitter (Wave 18V-DYNAMIC).
 *
 * Every lifecycle transition (draft→shadow→live→locked→deprecated)
 * is logged into the existing audit-hash-chain (Wave 18A/18R). This
 * module is the small contract surface for that emission — the
 * actual chain client is bound by the composition root.
 */

import type {
  JuniorLifecycleStatus,
  PersistedJuniorRecord,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Event shape
// ─────────────────────────────────────────────────────────────────────

export interface LifecycleAuditEvent {
  readonly kind: 'junior_lifecycle_transition';
  readonly junior_id: string;
  readonly tenant_id: string | null;
  readonly provenance: PersistedJuniorRecord['provenance'];
  readonly from_status: JuniorLifecycleStatus;
  readonly to_status: JuniorLifecycleStatus;
  readonly reason: string;
  readonly at: Date;
  readonly actor: 'lifecycle-worker' | 'owner' | 'spawner';
}

// ─────────────────────────────────────────────────────────────────────
// Emitter contract
// ─────────────────────────────────────────────────────────────────────

export interface AuditChainEmitter {
  (event: LifecycleAuditEvent): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory implementation (tests + dev)
// ─────────────────────────────────────────────────────────────────────

/**
 * Capture lifecycle events in-memory. Tests assert against the
 * `events` array; production wiring binds the audit-hash-chain
 * client instead.
 */
export function createInMemoryAuditChainEmitter(): {
  readonly emit: AuditChainEmitter;
  readonly events: ReadonlyArray<LifecycleAuditEvent>;
} {
  const events: LifecycleAuditEvent[] = [];
  return {
    emit: async (event) => {
      events.push(event);
    },
    get events() {
      return events;
    },
  };
}
