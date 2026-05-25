/**
 * Entity-store contract.
 *
 * This package consumes J1's entity-store via the interface below. J1
 * will conform to this contract; this file is the seam. If J1 ships
 * first, it can replace this with a re-export. If J5 ships first, this
 * file pins the surface J1 must implement.
 *
 * The store is the MD's blackboard — anomalies, opportunities,
 * recommendations, and fatigue history are all persisted here so the
 * brain-tick scheduler can read past state on the next tick.
 *
 * Pure contract — no I/O, no runtime. All implementations (in-memory
 * for tests, postgres-backed in production) must satisfy this surface.
 */
export type EntityScope = 'tenant' | 'platform-internal';

/**
 * An entity is a typed, versioned blob keyed by (scope, type, id). Tenant-scoped
 * entities are visible only to that tenant; platform-internal entities are
 * the HQ-admin's view (e.g. customer-owner churn risk, payroll variance).
 */
export interface Entity<TKind extends string, TData> {
  readonly scope: EntityScope;
  readonly tenantId: string | null;
  readonly kind: TKind;
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly data: TData;
}

export interface EntityWriteInput<TKind extends string, TData> {
  readonly scope: EntityScope;
  readonly tenantId: string | null;
  readonly kind: TKind;
  readonly id: string;
  readonly data: TData;
}

export interface EntityQuery {
  readonly scope?: EntityScope;
  readonly tenantId?: string | null;
  readonly kind?: string;
  readonly idPrefix?: string;
  readonly updatedSince?: string;
  readonly limit?: number;
}

/**
 * The thin contract J5 needs from the entity-store. We deliberately do
 * not require transactions across kinds — recommendations are
 * idempotent on (tenantId, recommendationId) so at-least-once writes are
 * safe.
 */
export interface EntityStore {
  read<TKind extends string, TData>(
    scope: EntityScope,
    tenantId: string | null,
    kind: TKind,
    id: string,
  ): Promise<Entity<TKind, TData> | null>;

  write<TKind extends string, TData>(
    input: EntityWriteInput<TKind, TData>,
  ): Promise<Entity<TKind, TData>>;

  list<TKind extends string, TData>(
    q: EntityQuery,
  ): Promise<ReadonlyArray<Entity<TKind, TData>>>;

  delete(
    scope: EntityScope,
    tenantId: string | null,
    kind: string,
    id: string,
  ): Promise<void>;
}
