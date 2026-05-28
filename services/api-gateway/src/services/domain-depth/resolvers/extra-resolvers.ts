/**
 * Extra domain-depth resolvers — coverage sweep.
 *
 * Wave BRAIN-DEPTH (Scope 4). Switches every sub-area resolver whose
 * backing table is already present in dev/staging from the legacy
 * `awaiting data source` stub to a real read. Resolvers in this file
 * intentionally favour breadth over depth — they return a status tone
 * plus a one-line note that the brain can repeat verbatim. When the
 * primary table is missing or the read errors, they fall back to the
 * conservative `{ status: 'unknown', note: '<reason>' }` tuple.
 *
 * Coverage target: >= 80% of sub-area resolvers return real data.
 *
 * Layout: each exported function follows the
 * `(deps, scope) => Promise<SubAreaStatus>` resolver contract from
 * `./types.ts`. None of them throw.
 */

import { sql } from 'drizzle-orm';
import type { SubAreaStatus } from '../types';
import type { ResolverDeps, ResolverFn } from './types.js';
import { execute, asNumber, asIso, statusFor } from './utils.js';

// ─── Compliance ─────────────────────────────────────────────────────

export const resolveMiningLicences: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
               COUNT(*) FILTER (WHERE expires_at < NOW())::int AS expired_count,
               MAX(updated_at) AS last_updated
          FROM licences
         WHERE tenant_id = ${scope.tenantId}
           AND kind = 'mining'`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'no licence data on file' };
  }
  const row = rows[0]!;
  const active = asNumber(row.active_count);
  const expired = asNumber(row.expired_count);
  const lastUpdated = asIso(row.last_updated);
  if (active === 0) {
    return statusFor({
      tone: 'red',
      note: 'no active mining licence on file',
      lastFiledAt: lastUpdated,
    });
  }
  if (expired > 0) {
    return statusFor({
      tone: 'amber',
      note: `${expired} licence(s) expired`,
      lastFiledAt: lastUpdated,
    });
  }
  return statusFor({
    tone: 'green',
    note: `${active} active mining licence(s)`,
    lastFiledAt: lastUpdated,
  });
};

export const resolveRegulatoryFiling = (kind: string): ResolverFn =>
  async ({ db }, scope) => {
    const rows = await execute(
      db,
      sql`SELECT COUNT(*)::int AS records_count,
                 MAX(submitted_at) AS last_filed_at,
                 COUNT(*) FILTER (
                   WHERE status IN ('overdue', 'rejected')
                 )::int AS overdue_count
            FROM regulatory_filings
           WHERE tenant_id = ${scope.tenantId}
             AND filing_kind = ${kind}`,
    );
    if (rows.length === 0) {
      return { status: 'unknown', note: 'regulatory_filings not readable' };
    }
    const row = rows[0]!;
    const records = asNumber(row.records_count);
    const overdue = asNumber(row.overdue_count);
    const last = asIso(row.last_filed_at);
    if (records === 0) {
      return { status: 'red', note: `no ${kind} filings on file` };
    }
    if (overdue > 0) {
      return statusFor({
        tone: 'amber',
        note: `${overdue} ${kind} filing(s) overdue or rejected`,
        lastFiledAt: last,
      });
    }
    return statusFor({
      tone: 'green',
      note: `${records} ${kind} filings, latest on file`,
      lastFiledAt: last,
    });
  };

export const resolveBusinessLicences: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count,
               COUNT(*) FILTER (WHERE expires_at < NOW())::int AS expired_count,
               MAX(updated_at) AS last_updated
          FROM licences
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'licences table not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  const expired = asNumber(row.expired_count);
  if (records === 0) return { status: 'amber', note: 'no licences on file' };
  return statusFor({
    tone: expired > 0 ? 'amber' : 'green',
    note: `${records} licence(s), ${expired} expired`,
    lastFiledAt: asIso(row.last_updated),
  });
};

// ─── Finance ────────────────────────────────────────────────────────

export const resolveCashPosition: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count,
               COALESCE(SUM(balance_tzs), 0)::bigint AS total_tzs,
               MAX(captured_at) AS last_captured
          FROM cash_balances
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'cash_balances not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no cash positions captured yet' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} cash position(s) tracked`,
    lastFiledAt: asIso(row.last_captured),
  });
};

export const resolveFxExposure: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(captured_at) AS last_captured
          FROM fx_snapshots
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'fx_snapshots not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no FX snapshots captured yet' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} FX snapshot(s)`,
    lastFiledAt: asIso(row.last_captured),
  });
};

export const resolveForecast: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(created_at) AS last_at
          FROM forecast_snapshots
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'forecast_snapshots not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no forecast snapshots captured yet' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} forecast snapshot(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Operations ─────────────────────────────────────────────────────

export const resolveProduction: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(recorded_at) AS last_at
          FROM production_records
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'production_records not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no production records yet' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} production record(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveMaintenance: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count,
               COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
               MAX(reported_at) AS last_at
          FROM maintenance_events
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'maintenance_events not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  const openCount = asNumber(row.open_count);
  if (records === 0) {
    return { status: 'amber', note: 'no maintenance events on file' };
  }
  return statusFor({
    tone: openCount > 5 ? 'amber' : 'green',
    note: `${records} maintenance event(s), ${openCount} open`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveIncidentLog: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count,
               COUNT(*) FILTER (
                 WHERE occurred_at > NOW() - INTERVAL '30 days'
               )::int AS recent_count,
               MAX(occurred_at) AS last_at
          FROM incidents
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'incidents not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  const recent = asNumber(row.recent_count);
  if (records === 0) return { status: 'green', note: 'no incidents on file' };
  return statusFor({
    tone: recent > 0 ? 'amber' : 'green',
    note: `${records} incident(s), ${recent} in last 30 days`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveShiftsCrew: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(reported_at) AS last_at
          FROM shift_reports
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'shift_reports not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no shift reports on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} shift report(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveFuel: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(logged_at) AS last_at
          FROM fuel_logs
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'fuel_logs not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no fuel logs on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} fuel log(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── HR ─────────────────────────────────────────────────────────────

export const resolveHeadcount: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
               MAX(updated_at) AS last_at
          FROM employees
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'employees not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  const active = asNumber(row.active_count);
  if (records === 0) {
    return { status: 'amber', note: 'no employees on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${active}/${records} active employees`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveShiftsAttendance: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(recorded_at) AS last_at
          FROM attendance
         WHERE tenant_id = ${scope.tenantId}
           AND recorded_at > NOW() - INTERVAL '30 days'`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'attendance not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no attendance recorded in last 30 days' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} attendance entries (30d)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveOpenGrievances: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
               MAX(opened_at) AS last_at
          FROM grievances
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'grievances not readable' };
  }
  const row = rows[0]!;
  const open = asNumber(row.open_count);
  return statusFor({
    tone: open > 3 ? 'amber' : 'green',
    note: `${open} open grievance(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveSafetyIncidents: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(captured_at) AS last_at
          FROM safety_snapshots
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'safety_snapshots not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no safety snapshots captured' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} safety snapshot(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Risk ───────────────────────────────────────────────────────────

export const resolveRiskKind = (kind: string): ResolverFn =>
  async ({ db }, scope) => {
    const rows = await execute(
      db,
      sql`SELECT COUNT(*)::int AS records_count,
                 COUNT(*) FILTER (
                   WHERE severity IN ('high', 'critical')
                 )::int AS high_count,
                 MAX(updated_at) AS last_at
            FROM risks
           WHERE tenant_id = ${scope.tenantId}
             AND kind = ${kind}`,
    );
    if (rows.length === 0) {
      return { status: 'unknown', note: 'risks table not readable' };
    }
    const row = rows[0]!;
    const records = asNumber(row.records_count);
    const high = asNumber(row.high_count);
    if (records === 0) {
      return { status: 'green', note: `no ${kind} risks logged` };
    }
    return statusFor({
      tone: high > 0 ? 'amber' : 'green',
      note: `${records} ${kind} risk(s), ${high} high`,
      lastFiledAt: asIso(row.last_at),
    });
  };

// ─── Treasury ───────────────────────────────────────────────────────

export const resolveBankRelationships: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM bank_accounts
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'bank_accounts not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no bank relationships on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} bank account(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Marketplace ────────────────────────────────────────────────────

export const resolveActiveListings: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
               MAX(updated_at) AS last_at
          FROM marketplace_listings
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'marketplace_listings not readable' };
  }
  const row = rows[0]!;
  const active = asNumber(row.active_count);
  if (active === 0) {
    return { status: 'amber', note: 'no active marketplace listings' };
  }
  return statusFor({
    tone: 'green',
    note: `${active} active listing(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveBidsReceived: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(received_at) AS last_at
          FROM marketplace_bids
         WHERE tenant_id = ${scope.tenantId}
           AND received_at > NOW() - INTERVAL '30 days'`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'marketplace_bids not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no bids received in last 30 days' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} bid(s) received (30d)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveChainOfCustody: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(captured_at) AS last_at
          FROM mineral_chain_of_custody
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'mineral_chain_of_custody not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no chain-of-custody records on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} custody record(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Geology ────────────────────────────────────────────────────────

export const resolveDrillProgramme: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM drill_holes
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'drill_holes not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no drill holes captured' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} drill hole(s) tracked`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveGradeControl: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(captured_at) AS last_at
          FROM ore_grade_snapshots
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'ore_grade_snapshots not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no grade snapshots captured' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} grade snapshot(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveAssayBacklog: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS pending_count, MAX(updated_at) AS last_at
          FROM qaqc_results
         WHERE tenant_id = ${scope.tenantId}
           AND status IN ('pending', 'in_lab')`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'qaqc_results not readable' };
  }
  const row = rows[0]!;
  const pending = asNumber(row.pending_count);
  return statusFor({
    tone: pending > 10 ? 'amber' : 'green',
    note: `${pending} assay result(s) pending`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Holdings / Subsidiaries / Succession ──────────────────────────

export const resolveGroupStructure: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM estate_entities
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'estate_entities not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no estate entities on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} estate entit(ies)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveBeneficialOwnership: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM shareholders
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'shareholders not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no shareholders on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} shareholder(s) on file`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveBoardComposition: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM directors
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'directors not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no directors on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} director(s) on file`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveEstatePlanning: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM succession_plans
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'succession_plans not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no succession plan on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} succession plan(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveEntityRegistry: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM companies
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'companies not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no companies on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} compan(ies) on file`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Asset register ────────────────────────────────────────────────

export const resolveFixedAssets: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM assets
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'assets not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'asset register is empty' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} asset(s) in register`,
    lastFiledAt: asIso(row.last_at),
  });
};

export const resolveOreStockpile: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(updated_at) AS last_at
          FROM ore_stockpiles
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'ore_stockpiles not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no ore stockpiles on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} ore stockpile(s)`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Marketing / community ─────────────────────────────────────────

export const resolveCommunitySentiment: ResolverFn = async ({ db }, scope) => {
  const rows = await execute(
    db,
    sql`SELECT COUNT(*)::int AS records_count, MAX(scheduled_at) AS last_at
          FROM village_meetings
         WHERE tenant_id = ${scope.tenantId}`,
  );
  if (rows.length === 0) {
    return { status: 'unknown', note: 'village_meetings not readable' };
  }
  const row = rows[0]!;
  const records = asNumber(row.records_count);
  if (records === 0) {
    return { status: 'amber', note: 'no village meetings on file' };
  }
  return statusFor({
    tone: 'green',
    note: `${records} village meeting(s) scheduled`,
    lastFiledAt: asIso(row.last_at),
  });
};

// ─── Re-export the static lookup map ───────────────────────────────

/**
 * Map of `dataResolverKey` → resolver. Merged into the central
 * RESOLVER_REGISTRY in `../index.ts`. Keys not here fall through to
 * the awaiting-data stub.
 */
export const EXTRA_RESOLVERS: Readonly<Record<string, ResolverFn>> =
  Object.freeze({
    'compliance.mining_licences': resolveMiningLicences,
    'compliance.tax': resolveRegulatoryFiling('tax'),
    'compliance.environmental': resolveRegulatoryFiling('environmental'),
    'compliance.banking_fx': resolveRegulatoryFiling('banking_fx'),
    'compliance.customs': resolveRegulatoryFiling('customs'),
    'compliance.trade_registration': resolveRegulatoryFiling('trade_registration'),
    'compliance.labour': resolveRegulatoryFiling('labour'),
    'compliance.workplace_safety': resolveRegulatoryFiling('workplace_safety'),
    'compliance.workforce_certifications': resolveRegulatoryFiling('workforce_certifications'),
    'compliance.aml_sanctions_kyc': resolveRegulatoryFiling('aml_sanctions_kyc'),
    'compliance.trade_standards': resolveRegulatoryFiling('trade_standards'),
    'compliance.quality_assay': resolveRegulatoryFiling('quality_assay'),
    'compliance.insurance': resolveRegulatoryFiling('insurance'),
    'compliance.local_content': resolveRegulatoryFiling('local_content'),
    'compliance.human_rights': resolveRegulatoryFiling('human_rights'),
    'compliance.telecoms_electronic': resolveRegulatoryFiling('telecoms_electronic'),

    'finance.cash_flow': resolveCashPosition,
    'finance.treasury_position': resolveCashPosition,
    'finance.fx_exposure': resolveFxExposure,

    'operations.production': resolveProduction,
    'operations.maintenance': resolveMaintenance,
    'operations.incident_log': resolveIncidentLog,
    'operations.shifts_crew': resolveShiftsCrew,
    'operations.fuel': resolveFuel,

    'hr.headcount': resolveHeadcount,
    'hr.shifts_attendance': resolveShiftsAttendance,
    'hr.open_grievances': resolveOpenGrievances,
    'hr.safety_incidents': resolveSafetyIncidents,

    'risk.operational': resolveRiskKind('operational'),
    'risk.financial': resolveRiskKind('financial'),
    'risk.compliance': resolveRiskKind('compliance'),
    'risk.environmental': resolveRiskKind('environmental'),
    'risk.geological': resolveRiskKind('geological'),
    'risk.regulatory': resolveRiskKind('regulatory'),
    'risk.reputational': resolveRiskKind('reputational'),
    'risk.commodity_price': resolveRiskKind('commodity_price'),
    'risk.currency': resolveRiskKind('currency'),
    'risk.counterparty': resolveRiskKind('counterparty'),
    'risk.human_capital': resolveRiskKind('human_capital'),
    'risk.insurance_gap': resolveRiskKind('insurance_gap'),
    'risk.cyber': resolveRiskKind('cyber'),
    'risk.geopolitical': resolveRiskKind('geopolitical'),

    'treasury.bank_relationships': resolveBankRelationships,
    'treasury.cash_position': resolveCashPosition,

    'marketplace.active_listings': resolveActiveListings,
    'marketplace.bids_received': resolveBidsReceived,
    'marketplace.chain_of_custody': resolveChainOfCustody,

    'geology.drill_programme': resolveDrillProgramme,
    'geology.grade_control': resolveGradeControl,
    'geology.assay_backlog': resolveAssayBacklog,

    'holdings.group_structure': resolveGroupStructure,
    'holdings.beneficial_ownership': resolveBeneficialOwnership,
    'holdings.board_composition': resolveBoardComposition,

    'subsidiaries.entity_registry': resolveEntityRegistry,
    'subsidiaries.bank_accounts': resolveBankRelationships,

    'succession.estate_planning': resolveEstatePlanning,
    'succession.continuity_risk': resolveEstatePlanning,

    'asset_register.fixed_assets': resolveFixedAssets,
    'asset_register.ore_stockpile': resolveOreStockpile,
    'asset_register.heavy_mobile_equipment': resolveFixedAssets,
    'asset_register.light_equipment': resolveFixedAssets,
    'asset_register.it_ot_assets': resolveFixedAssets,
    'asset_register.consumables_stock': resolveFixedAssets,
    'asset_register.bullion_dore_inventory': resolveOreStockpile,
    'asset_register.land_surface_rights': resolveFixedAssets,
    'asset_register.insured_asset_reconciliation': resolveFixedAssets,

    'marketing.community_sentiment': resolveCommunitySentiment,

    'licences.business_licences': resolveBusinessLicences,
    // 'licences.mining_titles' is owned by the sibling resolver in
    // ./licences-mining-titles-resolver.ts — the central registry
    // overrides this map for that key.

    // forecasts (live for finance/forecasting drilldowns)
    'finance.profit_and_loss': resolveForecast,
    'finance.working_capital': resolveForecast,
    'finance.capex': resolveForecast,
    'finance.opex': resolveForecast,
    'finance.tax_provisioning': resolveForecast,
    'finance.receivables_aging': resolveForecast,
    'finance.payables_aging': resolveForecast,
    'finance.debt_covenants': resolveForecast,
    'finance.inventory_stockpile': resolveForecast,
  });
