/**
 * Mining operations event store — core type surface.
 *
 * Ported from @litfin/ledger; the LITFIN lending-event shape was kept
 * verbatim and the closed event-type set was swapped for Borjie's
 * mining-domain meat (shifts / production / chain-of-custody / royalty
 * / payout). The store mechanics (optimistic concurrency, tenant
 * boundary, in-memory + Postgres backends, projector) are unchanged.
 *
 * The ledger is the SINGLE source of truth for every state-changing
 * fact in a mining operation. Application data, balance projections,
 * production state, royalty schedules — everything else is a read
 * model derived from this event stream.
 *
 * Stream identity:
 *   `shift:<orgId>:<shiftId>`       a single mining shift
 *   `site:<orgId>:<siteId>`         per-site cumulative ledger
 *   `consignment:<orgId>:<lotId>`   buyer mineral lot / consignment
 *
 * Per-stream `version` is monotonic from 1 and unique. Cross-stream
 * `globalSeq` is monotonic across the whole store and gives a global
 * total order for replay / reconciliation against a CBS (Core Banking
 * System) or PCCB / NEMC / EITI regulatory filing.
 *
 * The store is multi-tenant: every event carries a `tenantId` that
 * matches the Borjie org-scope. Reads ALWAYS filter by tenant; no
 * caller code may bypass that filter (see Drizzle adapter).
 *
 * NOTE: Borjie's money-path of record remains
 * `services/payments-ledger/LedgerService.post()` — this port is an
 * adjunct event-store usable for non-money operational logs (shift /
 * production / royalty intent), keeping the immutable double-entry
 * invariant intact.
 */

import type { MiningEvent, MiningEventType } from "./events";

/**
 * Envelope wrapping a domain event with its store coordinates.
 * Returned by `append`, by `read`, and pushed to subscribers.
 */
export interface EventEnvelope {
  /** Stream identity (shift / site / consignment). */
  readonly streamId: string;
  /** Tenant the stream belongs to. Always present; never inferred. */
  readonly tenantId: string;
  /** Per-stream monotonic version, starting at 1. */
  readonly version: number;
  /** Global monotonic sequence across all streams. Useful for
   *  replicating to a regulator filing system / data warehouse. */
  readonly globalSeq: number;
  /** The domain event. */
  readonly event: MiningEvent;
  /** Server-side ISO-8601 timestamp set at append time. */
  readonly recordedAt: string;
}

export interface SubscriptionFilter {
  /** Restrict to a single stream. */
  readonly streamId?: string;
  /** Restrict to a single tenant. Recommended for any cross-stream
   *  subscriber so we don't leak across orgs. */
  readonly tenantId?: string;
  /** Restrict to specific event types. */
  readonly eventTypes?: ReadonlyArray<MiningEventType>;
}

export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface AppendOptions {
  readonly streamId: string;
  readonly tenantId: string;
  readonly event: MiningEvent;
  /** Expected current max version of the stream. 0 for a new stream.
   *  Throws OptimisticConcurrencyError on mismatch. */
  readonly expectedVersion: number;
}

export interface EventStore {
  append(opts: AppendOptions): Promise<EventEnvelope>;
  read(
    streamId: string,
    opts?: { readonly tenantId?: string; readonly fromVersion?: number },
  ): Promise<ReadonlyArray<EventEnvelope>>;
  subscribe(filter: SubscriptionFilter, handler: EventHandler): Unsubscribe;
}

/**
 * Thrown when `expectedVersion` does not match the current max
 * version on the stream — i.e. another writer got there first. The
 * caller's job is to re-read the stream, re-derive its decision, and
 * retry.
 */
export class OptimisticConcurrencyError extends Error {
  readonly code = "OPTIMISTIC_CONCURRENCY";
  readonly streamId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(
    streamId: string,
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(
      `Optimistic concurrency violation on stream "${streamId}": expected version ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "OptimisticConcurrencyError";
    this.streamId = streamId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Thrown when an append crosses a tenant boundary (e.g. attempting to
 * append a "tenantId: orgA" event onto a stream whose existing
 * events all carry "tenantId: orgB"). The tenant of a stream is
 * fixed at its first event and immutable thereafter. This guard
 * complements the row-level security policy at the database tier.
 */
export class TenantBoundaryViolation extends Error {
  readonly code = "TENANT_BOUNDARY_VIOLATION";
  readonly streamId: string;
  readonly expectedTenantId: string;
  readonly actualTenantId: string;

  constructor(
    streamId: string,
    expectedTenantId: string,
    actualTenantId: string,
  ) {
    super(
      `Tenant boundary violation on stream "${streamId}": expected tenantId "${expectedTenantId}", got "${actualTenantId}"`,
    );
    this.name = "TenantBoundaryViolation";
    this.streamId = streamId;
    this.expectedTenantId = expectedTenantId;
    this.actualTenantId = actualTenantId;
  }
}
