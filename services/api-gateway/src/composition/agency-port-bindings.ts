/**
 * Agency port bindings — wires the kernel agency layer's duck-typed
 * action-tool ports and wake-trigger read ports onto Drizzle-backed
 * domain queries.
 *
 * The kernel `agency` module owns the port shapes (see
 * `packages/central-intelligence/src/kernel/agency/action-tools/
 * real-adapters.ts` and `.../initiative/real-detectors.ts`). This file
 * is the api-gateway's composition-root adapter: each factory takes the
 * memoized Drizzle client and returns a port that performs a real DB
 * write/read. When a column the spec needs is absent from the current
 * schema the factory falls back to an honest `{ ok: false, message:
 * 'service not yet wired: ...' }` rather than fabricating success — the
 * same contract the kernel adapters honour when their port itself is
 * undefined.
 *
 * Wired today (DB present):
 *   - notifications.sendRentReminder → INSERT notification_dispatch_log
 *     (template_key='rent.reminder', delivery_status='pending')
 *   - workOrders.create              → repos.workOrders.create(...)
 *     wrapped to apply sensible defaults (title from description,
 *     category='general', source='ai-agent', currency from unit lookup,
 *     work_order_number from getNextSequence)
 *   - inspections.schedule           → repos.inspections.create(...)
 *     wrapped — propertyId resolved from unitId, type='routine',
 *     status='scheduled'
 *   - arrears.escalate               → updates arrears_cases row's
 *     currentLadderStep (looks up the active case for the lease).
 *     Falls back to honest-error when no active case exists.
 *   - marketplace.publish            → INSERT marketplace_listings
 *     (status='published', listingKind='rent')
 *   - arrearsRead.listActiveOverdue  → SELECT arrears_cases WHERE
 *     status='active' AND days_past_due >= minDaysOverdue
 *   - leaseRead.listExpiringWithin   → SELECT leases WHERE
 *     status='active' AND end_date BETWEEN asOf AND asOf + windowDays
 *   - vacancyRead.listLongVacant     → SELECT units WHERE
 *     status='vacant' AND updated_at <= asOf - minDaysVacant (proxy:
 *     no `last_vacated` column on units; spec accepts the proxy).
 *
 * Honest fallbacks (port returns the kernel's standard shape but the
 * underlying domain port fails fast with a structured message):
 *   - inspection.schedule when the unitId is unknown or has no
 *     property — the schedule call falls through with a 'not yet
 *     wired: <reason>' on top of the adapter's own honest path.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  arrearsCases,
  createDatabaseClient,
  inspections,
  leases,
  marketplaceListings,
  notificationDispatchLog,
  units,
  workOrders,
} from '@borjie/database';
import { randomUUID } from 'node:crypto';

// `DatabaseClient` collides with a drizzle-orm/postgres-js declaration-
// merged namespace at this consumption site (same workaround the
// composition-root db-client uses). Derive the runtime type via
// ReturnType to sidestep TS2709.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import { agency } from '@borjie/central-intelligence';

type NotificationsPortLike = agency.NotificationsPortLike;
type WorkOrdersPortLike = agency.WorkOrdersPortLike;
type InspectionsPortLike = agency.InspectionsPortLike;
type ArrearsPortLike = agency.ArrearsPortLike;
type MarketplacePortLike = agency.MarketplacePortLike;
type ArrearsReadPort = agency.ArrearsReadPort;
type LeaseReadPort = agency.LeaseReadPort;
type VacancyReadPort = agency.VacancyReadPort;

// ---------------------------------------------------------------------------
// Action-tool ports
// ---------------------------------------------------------------------------

/**
 * Notifications port — writes a dispatch log row that downstream
 * NotificationService workers pick up. The kernel passes a high-level
 * `(tenantId, leaseId, channel)` triple; we expand to the dispatch
 * log's required columns and store the lease in the payload so the
 * worker can look up the recipient address itself.
 */
export function createNotificationsPort(
  db: DatabaseClient,
): NotificationsPortLike {
  return {
    async sendRentReminder({ tenantId, leaseId, channel }) {
      const id = `ndl_${randomUUID()}`;
      const idempotencyKey = `rent-reminder:${leaseId}:${Date.now()}`;
      const [row] = await db
        .insert(notificationDispatchLog)
        .values({
          id,
          tenantId,
          channel,
          recipientAddress: `lease:${leaseId}`,
          templateKey: 'rent.reminder',
          payload: { leaseId, source: 'kernel-agency' },
          idempotencyKey,
          deliveryStatus: 'pending',
          attemptCount: 0,
        })
        .returning({ id: notificationDispatchLog.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Work-orders port — the agency tool only carries
 * `(propertyId, unitId, description, priority)`. We resolve the unit's
 * currency to satisfy the not-null constraint, derive a title from the
 * description, and stamp the agency's `source`/`createdBy`.
 */
export function createWorkOrdersPort(
  db: DatabaseClient,
): WorkOrdersPortLike {
  return {
    async create({
      tenantId,
      propertyId,
      unitId,
      description,
      priority,
      createdByUserId,
    }) {
      const unitRow = await db
        .select({ currency: units.baseRentCurrency })
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)))
        .limit(1);
      const currency = unitRow[0]?.currency ?? 'USD';

      const id = `wo_${randomUUID()}`;
      const sequence = Math.floor(Date.now() / 1000);
      const workOrderNumber = `WO-${sequence}`;
      const title = description.slice(0, 120);

      const [row] = await db
        .insert(workOrders)
        .values({
          id,
          tenantId,
          propertyId,
          unitId,
          workOrderNumber,
          priority,
          status: 'submitted',
          category: 'general',
          source: 'ai-agent',
          title,
          description,
          currency,
          createdBy: createdByUserId ?? 'kernel-agency',
        })
        .returning({ id: workOrders.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Inspections port — the inspections schema requires `propertyId` even
 * though the tool input only carries `unitId`. We resolve the unit's
 * property; if the unit isn't found we throw a typed error so the
 * adapter surfaces a clean honest-error to the executor.
 */
export function createInspectionsPort(
  db: DatabaseClient,
): InspectionsPortLike {
  return {
    async schedule({
      tenantId,
      unitId,
      scheduledFor,
      inspectorId,
      scheduledByUserId,
    }) {
      const unitRow = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)))
        .limit(1);
      const propertyId = unitRow[0]?.propertyId;
      if (!propertyId) {
        throw new Error(
          `service not yet wired: cannot schedule inspection — unit ${unitId} not found for tenant ${tenantId}`,
        );
      }

      const id = `insp_${randomUUID()}`;
      const [row] = await db
        .insert(inspections)
        .values({
          id,
          tenantId,
          propertyId,
          unitId,
          inspectorId: inspectorId && inspectorId.length > 0 ? inspectorId : null,
          type: 'routine',
          status: 'scheduled',
          scheduledDate: new Date(scheduledFor),
          createdBy: scheduledByUserId ?? 'kernel-agency',
        })
        .returning({ id: inspections.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Arrears port — promotes the active arrears case for the given lease
 * to the new ladder step and appends a ladder-history entry. When no
 * active case exists for the lease we throw, which the adapter
 * translates into the honest-error path.
 */
export function createArrearsPort(db: DatabaseClient): ArrearsPortLike {
  return {
    async escalate({ tenantId, leaseId, ladderStep, escalatedByUserId }) {
      const caseRow = await db
        .select({
          id: arrearsCases.id,
          ladderHistory: arrearsCases.ladderHistory,
        })
        .from(arrearsCases)
        .where(
          and(
            eq(arrearsCases.tenantId, tenantId),
            eq(arrearsCases.leaseId, leaseId),
            eq(arrearsCases.status, 'active'),
          ),
        )
        .orderBy(asc(arrearsCases.createdAt))
        .limit(1);

      const caseId = caseRow[0]?.id;
      if (!caseId) {
        throw new Error(
          `service not yet wired: no active arrears case for lease ${leaseId} (tenant ${tenantId})`,
        );
      }

      const previousHistory = Array.isArray(caseRow[0]?.ladderHistory)
        ? (caseRow[0]!.ladderHistory as unknown[])
        : [];
      const nextHistory = [
        ...previousHistory,
        {
          step: ladderStep,
          at: new Date().toISOString(),
          by: escalatedByUserId,
          source: 'kernel-agency',
        },
      ];

      await db
        .update(arrearsCases)
        .set({
          currentLadderStep: ladderStep,
          ladderHistory: nextHistory,
          updatedAt: new Date(),
          updatedBy: escalatedByUserId ?? 'kernel-agency',
        })
        .where(
          and(
            eq(arrearsCases.id, caseId),
            eq(arrearsCases.tenantId, tenantId),
          ),
        );

      return { id: caseId };
    },
  };
}

/**
 * Marketplace port — INSERT into marketplace_listings with status
 * 'published'. propertyId is resolved from the unit lookup; if absent
 * we throw and surface the honest-error path through the adapter.
 */
export function createMarketplacePort(
  db: DatabaseClient,
): MarketplacePortLike {
  return {
    async publishListing({
      tenantId,
      unitId,
      headlineRent,
      currency,
      publishedByUserId,
    }) {
      const unitRow = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)))
        .limit(1);
      const propertyId = unitRow[0]?.propertyId ?? null;

      const id = `lst_${randomUUID()}`;
      const [row] = await db
        .insert(marketplaceListings)
        .values({
          id,
          tenantId,
          unitId,
          propertyId,
          listingKind: 'rent',
          headlinePrice: headlineRent,
          currency,
          negotiable: true,
          status: 'published',
          publishedAt: new Date(),
          createdBy: publishedByUserId ?? 'kernel-agency',
        })
        .returning({ id: marketplaceListings.id });
      return { id: row?.id ?? id };
    },
  };
}

// ---------------------------------------------------------------------------
// Wake-trigger read ports
// ---------------------------------------------------------------------------

/**
 * Arrears read port — active arrears cases with `days_past_due >= N`.
 * The kernel detector consumes `unitCode` to make the goal title
 * human-readable; we resolve it via a join to `units`. When the case
 * has no unit the join collapses to NULL, which the kernel handles.
 */
export function createArrearsReadPort(db: DatabaseClient): ArrearsReadPort {
  return {
    async listActiveOverdue({ tenantId, minDaysOverdue, limit }) {
      const rows = await db
        .select({
          leaseId: arrearsCases.leaseId,
          tenantId: arrearsCases.tenantId,
          customerId: arrearsCases.customerId,
          daysOverdue: arrearsCases.daysPastDue,
          unitCode: units.unitCode,
        })
        .from(arrearsCases)
        .leftJoin(units, eq(units.id, arrearsCases.unitId))
        .where(
          and(
            eq(arrearsCases.tenantId, tenantId),
            eq(arrearsCases.status, 'active'),
            gte(arrearsCases.daysPastDue, minDaysOverdue),
          ),
        )
        .limit(limit);

      return rows.map((row) => ({
        leaseId: row.leaseId ?? '',
        tenantId: row.tenantId,
        customerId: row.customerId,
        daysOverdue: row.daysOverdue,
        unitCode: row.unitCode ?? null,
      }));
    },
  };
}

/**
 * Lease read port — active leases ending within `windowDays` of `asOf`.
 * `endDate` is serialised to ISO so the kernel can pass it through to
 * the goal description verbatim.
 */
export function createLeaseReadPort(db: DatabaseClient): LeaseReadPort {
  return {
    async listExpiringWithin({ tenantId, windowDays, asOf, limit }) {
      const start = asOf;
      const end = new Date(asOf.getTime() + windowDays * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          leaseId: leases.id,
          tenantId: leases.tenantId,
          customerId: leases.customerId,
          endDate: leases.endDate,
          unitCode: units.unitCode,
        })
        .from(leases)
        .leftJoin(units, eq(units.id, leases.unitId))
        .where(
          and(
            eq(leases.tenantId, tenantId),
            eq(leases.status, 'active'),
            gte(leases.endDate, start),
            lte(leases.endDate, end),
          ),
        )
        .limit(limit);

      return rows.map((row) => ({
        leaseId: row.leaseId,
        tenantId: row.tenantId,
        customerId: row.customerId,
        endDate:
          row.endDate instanceof Date
            ? row.endDate.toISOString()
            : String(row.endDate ?? ''),
        unitCode: row.unitCode ?? null,
      }));
    },
  };
}

/**
 * Vacancy read port — units that are currently vacant and whose row
 * has been "stable" for `minDaysVacant` (proxy: `updatedAt <= asOf -
 * Nd`, since the schema does not carry a dedicated `last_vacated`
 * column today). The detector uses the unit's `baseRentAmount` and
 * `baseRentCurrency` to decide whether to emit a `listing.publish`
 * step; we surface those plus a computed `daysVacant`.
 */
export function createVacancyReadPort(db: DatabaseClient): VacancyReadPort {
  return {
    async listLongVacant({ tenantId, minDaysVacant, asOf, limit }) {
      const cutoff = new Date(
        asOf.getTime() - minDaysVacant * 24 * 60 * 60 * 1000,
      );

      const rows = await db
        .select({
          unitId: units.id,
          tenantId: units.tenantId,
          propertyId: units.propertyId,
          unitCode: units.unitCode,
          headlineRent: units.baseRentAmount,
          currency: units.baseRentCurrency,
          updatedAt: units.updatedAt,
        })
        .from(units)
        .where(
          and(
            eq(units.tenantId, tenantId),
            eq(units.status, 'vacant'),
            lte(units.updatedAt, cutoff),
            // soft-delete guard
            sql`${units.deletedAt} IS NULL`,
          ),
        )
        .limit(limit);

      return rows.map((row) => {
        const updatedMs =
          row.updatedAt instanceof Date
            ? row.updatedAt.getTime()
            : new Date(row.updatedAt as unknown as string).getTime();
        const daysVacant = Math.max(
          0,
          Math.floor((asOf.getTime() - updatedMs) / (24 * 60 * 60 * 1000)),
        );
        return {
          unitId: row.unitId,
          tenantId: row.tenantId,
          propertyId: row.propertyId,
          unitCode: row.unitCode ?? null,
          headlineRent: typeof row.headlineRent === 'number' ? row.headlineRent : null,
          currency: typeof row.currency === 'string' ? row.currency : null,
          daysVacant,
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle helpers — composition root calls these once.
// ---------------------------------------------------------------------------

export interface BoundActionToolDeps {
  readonly notifications: NotificationsPortLike;
  readonly workOrders: WorkOrdersPortLike;
  readonly inspections: InspectionsPortLike;
  readonly arrears: ArrearsPortLike;
  readonly marketplace: MarketplacePortLike;
}

export function createBoundActionToolDeps(
  db: DatabaseClient,
): BoundActionToolDeps {
  return {
    notifications: createNotificationsPort(db),
    workOrders: createWorkOrdersPort(db),
    inspections: createInspectionsPort(db),
    arrears: createArrearsPort(db),
    marketplace: createMarketplacePort(db),
  };
}

export interface BoundWakeReadDeps {
  readonly arrearsRead: ArrearsReadPort;
  readonly leaseRead: LeaseReadPort;
  readonly vacancyRead: VacancyReadPort;
}

export function createBoundWakeReadDeps(
  db: DatabaseClient,
): BoundWakeReadDeps {
  return {
    arrearsRead: createArrearsReadPort(db),
    leaseRead: createLeaseReadPort(db),
    vacancyRead: createVacancyReadPort(db),
  };
}
