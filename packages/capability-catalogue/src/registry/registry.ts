/**
 * Capability registry — port + in-memory adapter.
 *
 * The registry is the canonical interface the rest of the system uses
 * to find a capability, author a new one, or update lifecycle. Every
 * mutation is append-only — versions never overwrite. The in-memory
 * adapter implements the port for tests; a SQL adapter lives under
 * `src/repositories/capability-repository.ts`.
 *
 * @module @borjie/capability-catalogue/registry/registry
 */

import { randomUUID, createHash } from 'node:crypto';

import {
  type Capability,
  type CapabilityAuthorInput,
  CapabilityCatalogueError,
  type Lifecycle,
} from '../types.js';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface CapabilityRegistry {
  /**
   * Author a new capability. Always lands in `draft`. Throws on
   * duplicate `(tenantId, name, version)` or on `kind === 'atomic'`
   * authored by anyone other than the platform seed loader.
   */
  author(input: CapabilityAuthorInput): Promise<Capability>;

  /** Find by id; returns null if not found. */
  findById(id: string): Promise<Capability | null>;

  /** Find by (tenantId, name, version). Returns null if not found. */
  findByName(args: {
    readonly tenantId: string;
    readonly name: string;
    readonly version: string;
  }): Promise<Capability | null>;

  /**
   * List capabilities visible to a tenant. Seed capabilities
   * (tenantId = '__seed__') are always included; tenant-owned
   * capabilities only when tenantId matches.
   */
  list(args: {
    readonly tenantId: string;
    readonly lifecycleState?: Lifecycle;
  }): Promise<ReadonlyArray<Capability>>;

  /** Transition lifecycle. Returns the new row (a new audit-chain link). */
  transitionLifecycle(args: {
    readonly id: string;
    readonly nextState: Lifecycle;
  }): Promise<Capability>;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/**
 * Hash of canonical capability fields → audit hash. Mirrors the
 * `ai_audit_chain` shape: we append `(name|version|tenantId|state|prev)`
 * through SHA-256.
 */
function computeAuditHash(args: {
  readonly tenantId: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycleState: Lifecycle;
  readonly prevHash: string | null;
}): string {
  const h = createHash('sha256');
  h.update(args.tenantId);
  h.update('|');
  h.update(args.name);
  h.update('|');
  h.update(args.version);
  h.update('|');
  h.update(args.lifecycleState);
  h.update('|');
  h.update(args.prevHash ?? '');
  return h.digest('hex');
}

const VALID_TRANSITIONS: Readonly<Record<Lifecycle, ReadonlyArray<Lifecycle>>> =
  Object.freeze({
    draft: ['shadow', 'deprecated'],
    shadow: ['live', 'locked', 'deprecated'],
    live: ['locked', 'deprecated'],
    locked: ['live', 'deprecated'],
    deprecated: [],
  });

/**
 * Build an in-memory registry adapter. Backed by a Map keyed by id.
 * Per CODING-STYLE immutability rule: every public method that mutates
 * the catalogue returns a *new* capability object, never modifies the
 * caller's reference.
 */
export function createInMemoryCapabilityRegistry(): CapabilityRegistry {
  const byId = new Map<string, Capability>();

  function findByCompositeKey(
    tenantId: string,
    name: string,
    version: string,
  ): Capability | null {
    for (const row of byId.values()) {
      if (
        row.tenantId === tenantId &&
        row.name === name &&
        row.version === version
      ) {
        return row;
      }
    }
    return null;
  }

  return {
    async author(input) {
      if (input.kind === 'atomic' && input.provenanceClass !== 'seed') {
        throw new CapabilityCatalogueError(
          `kind 'atomic' is reserved for seed capabilities (got ${input.provenanceClass})`,
          'ATOMIC_RESERVED_FOR_SEED',
        );
      }
      const existing = findByCompositeKey(
        input.tenantId,
        input.name,
        input.version,
      );
      if (existing !== null) {
        throw new CapabilityCatalogueError(
          `capability (${input.tenantId}, ${input.name}, ${input.version}) already exists`,
          'DUPLICATE_VERSION',
        );
      }

      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const lifecycleState: Lifecycle = 'draft';
      const auditHash = computeAuditHash({
        tenantId: input.tenantId,
        name: input.name,
        version: input.version,
        lifecycleState,
        prevHash: null,
      });

      const row: Capability = Object.freeze({
        id,
        tenantId: input.tenantId,
        name: input.name,
        version: input.version,
        kind: input.kind,
        owner: input.owner,
        lifecycleState,
        dependencies: Object.freeze([...input.dependencies]),
        contract: Object.freeze({ ...input.contract }),
        provenanceClass: input.provenanceClass,
        createdAt,
        auditHash,
        prevHash: null,
      });

      byId.set(id, row);
      return row;
    },

    async findById(id) {
      return byId.get(id) ?? null;
    },

    async findByName({ tenantId, name, version }) {
      return findByCompositeKey(tenantId, name, version);
    },

    async list({ tenantId, lifecycleState }) {
      const out: Array<Capability> = [];
      for (const row of byId.values()) {
        // Seed capabilities are visible cross-tenant. Tenant capabilities
        // are only visible to their owning tenant.
        const visible =
          row.tenantId === tenantId || row.tenantId === '__seed__';
        if (!visible) continue;
        if (lifecycleState !== undefined && row.lifecycleState !== lifecycleState) {
          continue;
        }
        out.push(row);
      }
      return Object.freeze(out);
    },

    async transitionLifecycle({ id, nextState }) {
      const current = byId.get(id);
      if (!current) {
        throw new CapabilityCatalogueError(
          `capability ${id} not found`,
          'CAPABILITY_NOT_FOUND',
        );
      }
      const allowed = VALID_TRANSITIONS[current.lifecycleState];
      if (!allowed.includes(nextState)) {
        throw new CapabilityCatalogueError(
          `cannot transition ${current.lifecycleState} → ${nextState}`,
          'INVALID_LIFECYCLE_TRANSITION',
        );
      }
      const auditHash = computeAuditHash({
        tenantId: current.tenantId,
        name: current.name,
        version: current.version,
        lifecycleState: nextState,
        prevHash: current.auditHash,
      });
      const next: Capability = Object.freeze({
        ...current,
        lifecycleState: nextState,
        auditHash,
        prevHash: current.auditHash,
      });
      byId.set(id, next);
      return next;
    },
  };
}
