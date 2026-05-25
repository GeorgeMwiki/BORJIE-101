/**
 * @borjie/org-graph — projector.
 *
 * Projects edges from existing tables into `org_graph_edges` whenever
 * the underlying outbox publishes a relevant event:
 *
 *   - `lease.activated`         → `leased_to` (Unit → Person)
 *   - `lease.terminated`        → close prior `leased_to` (set valid_to)
 *   - `lease.payment.posted`    → `paid_by` (Lease → Person)
 *   - `unit.assigned_manager`   → `managed_by` (Unit → Person)
 *   - `org.parent_assigned`     → `reports_to` (Person → Person)
 *   - `subdivision.created`     → `subdivides` (Parent → Child)
 *   - `invoice.created`         → `invoiced_for` (Invoice → Lease)
 *   - `inspection.completed`    → `inspected_by` (Asset → Person)
 *
 * The projector is intentionally a pure function: it takes an event
 * shape and returns inserts/updates the caller persists. This makes
 * unit testing trivial and decouples the package from any specific
 * outbox / Drizzle interface.
 *
 * Pattern aligned with `services/consolidation-worker/src/stages/`
 * — small pure stages, side effects only at the orchestrator layer.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EdgeInsert, EdgeUpdate, EdgeType, OutboxEvent } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Event payload schemas — defensive validation per source. We never
// trust outbox payloads blindly; one stale row could corrupt the graph.
// ─────────────────────────────────────────────────────────────────────

const LeaseActivatedPayload = z.object({
  lease_id: z.string(),
  unit_entity_id: z.string(),
  person_entity_id: z.string(),
  start_date: z.coerce.date().optional(),
});

const LeaseTerminatedPayload = z.object({
  lease_id: z.string(),
  unit_entity_id: z.string(),
  person_entity_id: z.string(),
  end_date: z.coerce.date().optional(),
});

const LeasePaymentPayload = z.object({
  lease_id: z.string(),
  lease_entity_id: z.string(),
  person_entity_id: z.string(),
});

const UnitManagerPayload = z.object({
  unit_entity_id: z.string(),
  manager_entity_id: z.string(),
});

const OrgParentPayload = z.object({
  child_entity_id: z.string(),
  parent_entity_id: z.string(),
});

const SubdivisionPayload = z.object({
  parent_entity_id: z.string(),
  child_entity_id: z.string(),
});

const InvoiceCreatedPayload = z.object({
  invoice_entity_id: z.string(),
  lease_entity_id: z.string(),
});

const InspectionCompletedPayload = z.object({
  asset_entity_id: z.string(),
  inspector_entity_id: z.string(),
});

// ─────────────────────────────────────────────────────────────────────
// Projection result — what a single event produces.
// ─────────────────────────────────────────────────────────────────────

export interface ProjectionResult {
  readonly inserts: ReadonlyArray<EdgeInsert>;
  readonly updates: ReadonlyArray<EdgeUpdate>;
}

const EMPTY: ProjectionResult = Object.freeze({
  inserts: Object.freeze([]) as ReadonlyArray<EdgeInsert>,
  updates: Object.freeze([]) as ReadonlyArray<EdgeUpdate>,
});

// ─────────────────────────────────────────────────────────────────────
// Port for looking up an existing edge (so we know which to close
// when a lease terminates). Implementations live in the api-gateway
// / consolidation-worker; the package only knows the shape.
// ─────────────────────────────────────────────────────────────────────

export interface CurrentEdgeLookupPort {
  /**
   * Returns the id of the currently-valid (valid_to IS NULL) edge of
   * the given type between the two entities, or null when none exists.
   */
  findCurrentEdgeId(args: {
    readonly tenantId: string;
    readonly srcEntityId: string;
    readonly dstEntityId: string;
    readonly edgeType: EdgeType;
  }): Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Public — project a single event.
//
// Caller is responsible for persisting `inserts` and applying `updates`
// (set valid_to on the matching prior edge ids).
//
// Unknown event types are silently ignored — we don't want to throw
// on every outbox event the projector doesn't care about.
// ─────────────────────────────────────────────────────────────────────

export async function projectEvent(
  event: OutboxEvent,
  lookup: CurrentEdgeLookupPort,
): Promise<ProjectionResult> {
  switch (event.type) {
    case 'lease.activated': {
      const payload = LeaseActivatedPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.unit_entity_id,
        dstEntityId: payload.data.person_entity_id,
        edgeType: 'leased_to',
        weight: 1.0,
        validFrom: payload.data.start_date ?? event.occurredAt,
        evidenceRefs: [`lease:${payload.data.lease_id}`],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'lease.terminated': {
      const payload = LeaseTerminatedPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const existingId = await lookup.findCurrentEdgeId({
        tenantId: event.tenantId,
        srcEntityId: payload.data.unit_entity_id,
        dstEntityId: payload.data.person_entity_id,
        edgeType: 'leased_to',
      });
      if (!existingId) return EMPTY;
      return {
        inserts: [],
        updates: [{
          id: existingId,
          tenantId: event.tenantId,
          validTo: payload.data.end_date ?? event.occurredAt,
        }],
      };
    }

    case 'lease.payment.posted': {
      const payload = LeasePaymentPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.lease_entity_id,
        dstEntityId: payload.data.person_entity_id,
        edgeType: 'paid_by',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [`payment:${payload.data.lease_id}`],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'unit.assigned_manager': {
      const payload = UnitManagerPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.unit_entity_id,
        dstEntityId: payload.data.manager_entity_id,
        edgeType: 'managed_by',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'org.parent_assigned': {
      const payload = OrgParentPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.child_entity_id,
        dstEntityId: payload.data.parent_entity_id,
        edgeType: 'reports_to',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'subdivision.created': {
      const payload = SubdivisionPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.parent_entity_id,
        dstEntityId: payload.data.child_entity_id,
        edgeType: 'subdivides',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'invoice.created': {
      const payload = InvoiceCreatedPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.invoice_entity_id,
        dstEntityId: payload.data.lease_entity_id,
        edgeType: 'invoiced_for',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [],
      };
      return { inserts: [insert], updates: [] };
    }

    case 'inspection.completed': {
      const payload = InspectionCompletedPayload.safeParse(event.payload);
      if (!payload.success) return EMPTY;
      const insert: EdgeInsert = {
        id: makeId('edge'),
        tenantId: event.tenantId,
        srcEntityId: payload.data.asset_entity_id,
        dstEntityId: payload.data.inspector_entity_id,
        edgeType: 'inspected_by',
        weight: 1.0,
        validFrom: event.occurredAt,
        evidenceRefs: [],
      };
      return { inserts: [insert], updates: [] };
    }

    default:
      return EMPTY;
  }
}

/**
 * Batch projection: apply `projectEvent` over a stream of events and
 * concatenate the results. Caller still applies them in one transaction.
 */
export async function projectEvents(
  events: ReadonlyArray<OutboxEvent>,
  lookup: CurrentEdgeLookupPort,
): Promise<ProjectionResult> {
  const inserts: EdgeInsert[] = [];
  const updates: EdgeUpdate[] = [];
  for (const ev of events) {
    const part = await projectEvent(ev, lookup);
    inserts.push(...part.inserts);
    updates.push(...part.updates);
  }
  return { inserts, updates };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
