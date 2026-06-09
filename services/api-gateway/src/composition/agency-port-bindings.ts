/**
 * Agency port bindings — wires the kernel agency layer's duck-typed
 * action-tool ports and wake-trigger read ports onto Drizzle-backed
 * MINING-domain queries.
 *
 * The kernel `agency` module owns the port shapes (see
 * `packages/central-intelligence/src/kernel/agency/action-tools/
 * real-adapters.ts` and `.../initiative/real-detectors.ts`). Those
 * shapes are DOMAIN-AGNOSTIC — they accept string ids and return
 * `{ id }`. This file is the api-gateway's composition-root adapter:
 * each factory takes the memoized Drizzle client and returns a port
 * that performs a real DB write/read against a SURVIVING mining table.
 *
 * The property-domain tables the original bindings targeted
 * (`work_orders`, `inspections`, `arrears_cases`, `leases`, `units`,
 * `notification_dispatch_log`) were ALL dropped in migration
 * `0003_mining_domain.sql`. Importing them from the `@borjie/database`
 * barrel binds `undefined`, and the first `db.insert(undefined)` /
 * `db.select().from(undefined)` throws a raw Drizzle TypeError. This
 * rewrite re-points every port to its mining equivalent:
 *
 *   - notifications.sendRentReminder → INSERT notifications_outbox
 *     (a royalty/agreement reminder for the tenant's owner role).
 *   - workOrders.create              → INSERT mining_tasks (kind=
 *     'maintenance') — a manager-assigned maintenance task on a site.
 *   - inspections.schedule           → INSERT mining_tasks (kind=
 *     'inspection') — a scheduled site/equipment inspection task.
 *   - arrears.escalate               → INSERT mining_escalations
 *     (source_kind='production', a royalty/payment-dispute escalation).
 *   - marketplace.publish            → INSERT marketplace_listings
 *     (status='active') — the mining mineral marketplace.
 *   - arrearsRead.listActiveOverdue  → SELECT sales WHERE
 *     payment_status='pending' AND ts older than N days (overdue
 *     mineral-sale payments — the mining analog of overdue rent).
 *   - leaseRead.listExpiringWithin   → honest empty (offtake_agreements
 *     carry no expiry column today; the detector handles `[]`).
 *   - vacancyRead.listLongVacant     → SELECT sites WHERE status in
 *     ('paused','abandoned') AND updated_at <= asOf - Nd (idle sites,
 *     the mining analog of a long-vacant unit).
 *
 * Honest-degrade contract (unchanged): every port either runs for real
 * or surfaces a structured `service not yet wired: <reason>` /
 * graceful-empty result. A missing column or row never throws a raw
 * TypeError to the executor.
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import {
  createDatabaseClient,
  marketplaceListings,
  miningEscalations,
  miningTasks,
  notificationsOutbox,
  sales,
  sites,
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

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Action-tool ports
// ---------------------------------------------------------------------------

/**
 * Notifications port — writes a `notifications_outbox` row the downstream
 * notification workers pick up. The kernel passes a high-level
 * `(tenantId, leaseId, channel)` triple; in the mining domain `leaseId`
 * is the agreement / royalty reference. We route the reminder to the
 * tenant's owner role (the outbox row carries the originating reference
 * in its `summary` so the worker can resolve the recipient address).
 */
export function createNotificationsPort(
  db: DatabaseClient,
): NotificationsPortLike {
  return {
    async sendRentReminder({ tenantId, leaseId, channel }) {
      const id = `nout_${randomUUID()}`;
      const [row] = await db
        .insert(notificationsOutbox)
        .values({
          id,
          tenantId,
          // The owner role is the canonical recipient for a royalty /
          // agreement reminder; the worker resolves the owner's address.
          recipientUserId: `role:owner`,
          category: 'royalty.reminder',
          severity: 'info',
          summary: {
            agreementRef: leaseId,
            channel,
            source: 'kernel-agency',
          },
        })
        .returning({ id: notificationsOutbox.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Work-orders port — the agency tool carries
 * `(propertyId, unitId, description, priority)`. In the mining domain a
 * "work order" is a maintenance `mining_tasks` row. `unitId` is treated
 * as the optional `site_id`; the description becomes the bilingual task
 * title (Swahili-first per the CLAUDE.md hard rule — we mirror the same
 * text into both columns since the agency only supplies one string).
 */
export function createWorkOrdersPort(
  db: DatabaseClient,
): WorkOrdersPortLike {
  return {
    async create({ tenantId, unitId, description, priority, createdByUserId }) {
      const title = description.slice(0, 120);
      const id = randomUUID();
      const [row] = await db
        .insert(miningTasks)
        .values({
          id,
          tenantId,
          ...(isUuid(unitId) ? { siteId: unitId } : {}),
          ...(isUuid(createdByUserId) ? { assignedByUserId: createdByUserId } : {}),
          titleSw: title,
          titleEn: title,
          descriptionSw: description,
          descriptionEn: description,
          priority: normalizePriority(priority),
          status: 'pending',
          kind: 'maintenance',
        })
        .returning({ id: miningTasks.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Inspections port — the agency tool carries
 * `(unitId, scheduledFor, inspectorId)`. In the mining domain a
 * scheduled inspection is a `mining_tasks` row with `kind='inspection'`,
 * `site_id=unitId`, `assigned_to_user_id=inspectorId`, and `due_at` set
 * to the scheduled date.
 */
export function createInspectionsPort(
  db: DatabaseClient,
): InspectionsPortLike {
  return {
    async schedule({ tenantId, unitId, scheduledFor, inspectorId, scheduledByUserId }) {
      const dueAt = new Date(scheduledFor);
      if (Number.isNaN(dueAt.getTime())) {
        throw new Error(
          `service not yet wired: cannot schedule inspection — invalid scheduledFor '${scheduledFor}'`,
        );
      }
      const title = `Site inspection${isUuid(unitId) ? ` (site ${unitId})` : ''}`;
      const id = randomUUID();
      const [row] = await db
        .insert(miningTasks)
        .values({
          id,
          tenantId,
          ...(isUuid(unitId) ? { siteId: unitId } : {}),
          ...(isUuid(inspectorId) ? { assignedToUserId: inspectorId } : {}),
          ...(isUuid(scheduledByUserId) ? { assignedByUserId: scheduledByUserId } : {}),
          titleSw: title,
          titleEn: title,
          priority: 'normal',
          status: 'pending',
          kind: 'inspection',
          dueAt,
        })
        .returning({ id: miningTasks.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Arrears port — promotes a royalty/payment delinquency to a human by
 * opening a `mining_escalations` row (`source_kind='production'`,
 * severity scaled by ladder step). `leaseId` is the originating
 * agreement / sale reference; `escalatedByUserId` is the raiser.
 */
export function createArrearsPort(db: DatabaseClient): ArrearsPortLike {
  return {
    async escalate({ tenantId, leaseId, ladderStep, escalatedByUserId }) {
      const raisedBy = isUuid(escalatedByUserId) ? escalatedByUserId : 'kernel-agency';
      const severity = ladderStep >= 3 ? 'critical' : ladderStep >= 2 ? 'warning' : 'info';
      const id = randomUUID();
      const [row] = await db
        .insert(miningEscalations)
        .values({
          id,
          tenantId,
          raisedByUserId: raisedBy,
          toRole: 'owner',
          sourceKind: 'production',
          sourceId: leaseId,
          contextSw: `Ongezo la deni la mrabaha — hatua ya ngazi ${ladderStep} kwa makubaliano ${leaseId}.`,
          severity,
          status: 'open',
        })
        .returning({ id: miningEscalations.id });
      return { id: row?.id ?? id };
    },
  };
}

/**
 * Marketplace port — INSERT into the mining `marketplace_listings`
 * (status='active'). The agency tool carries `(unitId, headlineRent,
 * currency, publishedByUserId)`; in the mining domain `unitId` is the
 * parcel/site reference, `headlineRent` is the asking price. The mining
 * listings table prices in TZS (`price_tzs`) — we never hard-code a
 * currency: a TZS price is stored verbatim; a non-TZS asking price is
 * recorded in the title so the seller can reconcile (the table has no
 * generic price-currency column).
 */
export function createMarketplacePort(
  db: DatabaseClient,
): MarketplacePortLike {
  return {
    async publishListing({ tenantId, unitId, headlineRent, currency, publishedByUserId }) {
      const isTzs = currency.toUpperCase() === 'TZS';
      const title = `Mineral parcel ${unitId}${isTzs ? '' : ` (${currency} ${headlineRent})`}`;
      const id = `mlst_${randomUUID()}`;
      const [row] = await db
        .insert(marketplaceListings)
        .values({
          id,
          tenantId,
          category: 'mineral',
          title: title.slice(0, 200),
          description: `Listing published by Mr. Mwikila for ${unitId}.`,
          ...(isTzs ? { priceTzs: String(headlineRent) } : {}),
          priceUnit: 'parcel',
          ...(isUuid(publishedByUserId) ? { contactUserId: publishedByUserId } : {}),
          visibility: 'tanzania',
          status: 'active',
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
 * Arrears read port — mineral sales whose payment is still `pending`
 * more than `minDaysOverdue` after the sale timestamp. This is the
 * mining analog of "active overdue arrears": the cash owed for a
 * delivered parcel that the buyer has not yet settled. `leaseId` maps
 * to the sale id, `customerId` to the buyer, `unitCode` to the parcel.
 */
export function createArrearsReadPort(db: DatabaseClient): ArrearsReadPort {
  return {
    async listActiveOverdue({ tenantId, minDaysOverdue, asOf, limit }) {
      const cutoff = new Date(asOf.getTime() - minDaysOverdue * DAY_MS);
      const rows = await db
        .select({
          saleId: sales.id,
          tenantId: sales.tenantId,
          buyerId: sales.buyerId,
          parcelId: sales.parcelId,
          ts: sales.ts,
        })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, tenantId),
            eq(sales.paymentStatus, 'pending'),
            lte(sales.ts, cutoff),
          ),
        )
        .limit(limit);

      return rows.map((row) => {
        const tsMs =
          row.ts instanceof Date ? row.ts.getTime() : new Date(row.ts).getTime();
        const daysOverdue = Math.max(
          0,
          Math.floor((asOf.getTime() - tsMs) / DAY_MS),
        );
        return {
          leaseId: row.saleId,
          tenantId: row.tenantId,
          customerId: row.buyerId ?? '',
          daysOverdue,
          unitCode: row.parcelId ?? null,
        };
      });
    },
  };
}

/**
 * Lease read port — "agreements expiring within N days". Offtake
 * agreements carry no expiry column today, so this read honestly
 * degrades to an empty array (the wake-loop's count stays accurate and
 * the detector emits no goals). Adding an `expires_at` column later is
 * a one-place change here, not new code in the kernel.
 */
export function createLeaseReadPort(_db: DatabaseClient): LeaseReadPort {
  return {
    async listExpiringWithin() {
      // No expiry column on offtake_agreements — honest empty.
      return [];
    },
  };
}

/**
 * Vacancy read port — idle sites (the mining analog of a long-vacant
 * unit). A `site` whose `status` is `paused` or `abandoned` and whose
 * row has been stable (`updated_at <= asOf - minDaysVacant`) is an idle
 * asset the brain can flag for re-activation. `headlineRent` / currency
 * are not available on a site, so they are returned null; the detector
 * handles nulls.
 */
export function createVacancyReadPort(db: DatabaseClient): VacancyReadPort {
  return {
    async listLongVacant({ tenantId, minDaysVacant, asOf, limit }) {
      const cutoff = new Date(asOf.getTime() - minDaysVacant * DAY_MS);
      const rows = await db
        .select({
          siteId: sites.id,
          tenantId: sites.tenantId,
          licenceId: sites.licenceId,
          name: sites.name,
          updatedAt: sites.updatedAt,
        })
        .from(sites)
        .where(
          and(
            eq(sites.tenantId, tenantId),
            sql`${sites.status} in ('paused','abandoned')`,
            lte(sites.updatedAt, cutoff),
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
          Math.floor((asOf.getTime() - updatedMs) / DAY_MS),
        );
        return {
          unitId: row.siteId,
          tenantId: row.tenantId,
          // The kernel detector reads `propertyId` as the parent
          // grouping id — the site's licence is the mining equivalent.
          propertyId: row.licenceId,
          unitCode: row.name ?? null,
          headlineRent: null,
          currency: null,
          daysVacant,
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Several mining tables type their FK columns as `uuid`. The agency
 * tools pass opaque string ids that are NOT always uuid-shaped (e.g. a
 * synthetic `kernel-agency` actor). Guarding the insert with a uuid
 * check keeps a non-uuid id from triggering a Postgres cast error —
 * the column simply stays NULL (all are nullable) and the row still
 * lands, preserving the honest-degrade contract.
 */
function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Map the agency's 4-level priority onto the mining-tasks 4-level set. */
function normalizePriority(
  priority: 'low' | 'medium' | 'high' | 'critical',
): 'low' | 'normal' | 'high' | 'urgent' {
  switch (priority) {
    case 'low':
      return 'low';
    case 'high':
      return 'high';
    case 'critical':
      return 'urgent';
    default:
      return 'normal';
  }
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
