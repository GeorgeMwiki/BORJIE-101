/**
 * /api/v1/mining/fleet — fleet unit register + loader/truck match-factor (OW-10).
 *
 * Backs the owner-web O-W-09 fleet sidebar
 * (`apps/owner-web/src/app/(routes)/fleet/page.tsx`), which today only
 * renders the maintenance feed and notes these two endpoints as
 * not-yet-built. Both read REAL, RLS-scoped rows from
 * `assets-fleet.schema.ts` (`assets` + `maintenance_events`).
 *
 * Routes:
 *   GET /units          fleet register: id / label / type / health / status
 *   GET /match-factor   loader↔truck balance per site (see HONESTY note)
 *
 * HEALTH derivation (REAL): an asset is `down` when status is
 * broken/under_maintenance OR it has an open/in-progress maintenance
 * event; `due` when it has a scheduled (future) service; else `healthy`.
 *
 * MATCH-FACTOR HONESTY (no fabricated engineering figure): the textbook
 * match factor = (truck arrival rate / loader service rate) needs cycle
 * times + payload/bucket telemetry the `assets` schema does NOT carry.
 * We therefore return the REAL signal we CAN derive — operational
 * loader vs truck COUNTS per site and their ratio — and FLAG that the
 * precise time-based match factor requires cycle-time / payload fields
 * that need a new telemetry source. We never invent a ratio.
 *
 * RLS: databaseMiddleware binds app.current_tenant_id; `assets` +
 * `maintenance_events` are FORCE-RLS. Handlers do not double-filter
 * beyond the explicit tenant predicate other mining routes also keep.
 */

import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { assets, maintenanceEvents } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-fleet');

/** Asset kinds that load/excavate (the "loader" side of a match factor). */
const LOADER_KINDS = ['excavator', 'crusher'] as const;
/** Asset kinds that haul (the "truck" side of a match factor). */
const HAULER_KINDS = ['truck', 'vehicle'] as const;

type FleetHealth = 'healthy' | 'due' | 'down';

function deriveHealth(
  assetStatus: string,
  hasOpenEvent: boolean,
  hasScheduledEvent: boolean,
): FleetHealth {
  if (
    assetStatus === 'broken' ||
    assetStatus === 'under_maintenance' ||
    hasOpenEvent
  ) {
    return 'down';
  }
  if (hasScheduledEvent) return 'due';
  return 'healthy';
}

export const miningFleetRouter = new Hono();
miningFleetRouter.use('*', authMiddleware);
miningFleetRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /units — fleet register with health rollup.
// ---------------------------------------------------------------------------
miningFleetRouter.get('/units', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) {
    return c.json(
      { success: false, error: { code: 'FLEET_DB_UNAVAILABLE' } },
      503,
    );
  }
  try {
    const rows = await db
      .select({
        id: assets.id,
        kind: assets.kind,
        make: assets.make,
        model: assets.model,
        serialNumber: assets.serialNumber,
        status: assets.status,
        currentSiteId: assets.currentSiteId,
        totalHours: assets.totalHours,
        owned: assets.owned,
      })
      .from(assets)
      .where(eq(assets.tenantId, auth.tenantId))
      .limit(500);

    // Per-asset open / scheduled maintenance flags (single grouped query).
    const eventFlags = await db
      .select({
        assetId: maintenanceEvents.assetId,
        openCount: sql<number>`
          COUNT(*) FILTER (
            WHERE ${maintenanceEvents.status} IN ('open', 'in_progress')
          )
        `,
        scheduledCount: sql<number>`
          COUNT(*) FILTER (
            WHERE ${maintenanceEvents.scheduledFor} IS NOT NULL
              AND ${maintenanceEvents.scheduledFor} > NOW()
              AND ${maintenanceEvents.status} NOT IN ('completed', 'cancelled')
          )
        `,
      })
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.tenantId, auth.tenantId))
      .groupBy(maintenanceEvents.assetId);

    const flagByAsset = new Map<string, { open: boolean; scheduled: boolean }>(
      eventFlags.map((f) => [
        String(f.assetId),
        {
          open: Number(f.openCount ?? 0) > 0,
          scheduled: Number(f.scheduledCount ?? 0) > 0,
        },
      ]),
    );

    const units = rows.map((r) => {
      const flags = flagByAsset.get(String(r.id)) ?? {
        open: false,
        scheduled: false,
      };
      const status = String(r.status ?? 'operational');
      const label =
        [r.make, r.model].filter(Boolean).join(' ').trim() ||
        (r.serialNumber ? String(r.serialNumber) : String(r.id));
      return {
        id: String(r.id),
        label,
        type: String(r.kind ?? 'unknown'),
        status,
        health: deriveHealth(status, flags.open, flags.scheduled),
        siteId: r.currentSiteId ? String(r.currentSiteId) : null,
        totalHours: r.totalHours !== null ? Number(r.totalHours) : null,
        owned: Boolean(r.owned),
      };
    });

    return c.json(
      { success: true as const, data: { units, count: units.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'fleet_units_failed');
    return c.json(
      { success: false, error: { code: 'FLEET_UNITS_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /match-factor — loader↔truck balance per site (REAL counts + FLAG).
// ---------------------------------------------------------------------------
miningFleetRouter.get('/match-factor', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) {
    return c.json(
      { success: false, error: { code: 'FLEET_DB_UNAVAILABLE' } },
      503,
    );
  }
  try {
    // Count OPERATIONAL loaders vs haulers per site. Only operational
    // units participate in a live match factor.
    const rows = await db
      .select({
        siteId: assets.currentSiteId,
        kind: assets.kind,
        operational: sql<number>`
          COUNT(*) FILTER (WHERE ${assets.status} = 'operational')
        `,
      })
      .from(assets)
      .where(
        and(
          eq(assets.tenantId, auth.tenantId),
          inArray(assets.kind, [...LOADER_KINDS, ...HAULER_KINDS]),
        ),
      )
      .groupBy(assets.currentSiteId, assets.kind);

    const perSite = new Map<
      string,
      { loaders: number; haulers: number }
    >();
    for (const r of rows) {
      const siteKey = r.siteId ? String(r.siteId) : 'unassigned';
      const entry = perSite.get(siteKey) ?? { loaders: 0, haulers: 0 };
      const n = Number(r.operational ?? 0);
      if ((LOADER_KINDS as readonly string[]).includes(String(r.kind))) {
        entry.loaders += n;
      } else {
        entry.haulers += n;
      }
      perSite.set(siteKey, entry);
    }

    const sites = Array.from(perSite.entries()).map(([siteId, v]) => ({
      siteId: siteId === 'unassigned' ? null : siteId,
      operationalLoaders: v.loaders,
      operationalHaulers: v.haulers,
      // Count-based balance ratio (haulers per loader). NULL when no
      // loaders, since the ratio is undefined.
      haulerToLoaderRatio:
        v.loaders > 0
          ? Math.round((v.haulers / v.loaders) * 100) / 100
          : null,
    }));

    return c.json(
      {
        success: true as const,
        data: {
          sites,
          basis: 'operational_unit_counts' as const,
          flags: [
            'FLAG: this is a COUNT-based loader/hauler balance, not the ' +
              'time-based engineering match factor (truck arrival rate / ' +
              'loader service rate). The precise figure needs per-unit cycle ' +
              'time + bucket/payload telemetry which the assets schema does ' +
              'not carry — a new telemetry source/migration is required.',
            'FLAG: loader kinds = excavator|crusher; hauler kinds = ' +
              'truck|vehicle. Units with no current_site_id roll up under ' +
              'siteId: null.',
          ],
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'fleet_match_factor_failed',
    );
    return c.json(
      { success: false, error: { code: 'FLEET_MATCH_FACTOR_FAILED' } },
      500,
    );
  }
});

export default miningFleetRouter;
