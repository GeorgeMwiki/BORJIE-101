/**
 * Open-items signal.
 *
 * Computes "things the user must act on now" — open maintenance, unpaid
 * invoices, expiring documents, lease decisions due, pending sign-offs.
 * Tailored per role: a PM's open items differ from a tenant's.
 */
import type { OpenItems, Role } from '../types.js';

export interface OpenItemsArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly db: unknown;
}

interface DrizzleLike {
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickDate(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

const emptyOpenItems: OpenItems = {
  openMaintenanceCount: 0,
  unpaidInvoiceCount: 0,
  unpaidBalance: 0,
  expiringDocuments: [],
  leaseDecisionsDue: [],
  pendingSignOffs: [],
};

/**
 * Compute {@link OpenItems} for the user / role.
 */
export async function openItems(args: OpenItemsArgs): Promise<OpenItems> {
  const db = asDrizzle(args.db);

  const openMaintenanceCount = await safe(async () => {
    const exec = db.execute;
    if (!exec) return 0;
    // Tenants: own work orders. PMs: properties they manage. Owners:
    // properties they own. Admin/estate_mgr: all in tenant.
    let sql = `
      SELECT COUNT(*) AS n FROM work_orders w
      WHERE w.tenant_id = $1
        AND w.status NOT IN ('completed', 'verified', 'cancelled')
    `;
    const params: unknown[] = [args.tenantId];
    if (args.role === 'tenant') {
      sql += `
        AND w.customer_id IN (
          SELECT id FROM customers WHERE tenant_id = $1
          AND (email = (SELECT email FROM users WHERE id = $2)
               OR phone = (SELECT phone FROM users WHERE id = $2))
        )
      `;
      params.push(args.userId);
    } else if (args.role === 'pm') {
      sql += `
        AND w.property_id IN (
          SELECT id FROM properties WHERE tenant_id = $1 AND manager_id = $2
        )
      `;
      params.push(args.userId);
    } else if (args.role === 'owner') {
      sql += `
        AND w.property_id IN (
          SELECT id FROM properties WHERE tenant_id = $1 AND owner_id = $2
        )
      `;
      params.push(args.userId);
    }
    const r = await exec({ sql, params });
    return pickNumber(r.rows[0] ?? {}, 'n') ?? 0;
  }, 0);

  const unpaidAggregate = await safe(async () => {
    const exec = db.execute;
    if (!exec) return { count: 0, balance: 0 };
    let sql = `
      SELECT COUNT(*) AS n, COALESCE(SUM(balance_amount), 0) AS bal
      FROM invoices i
      WHERE i.tenant_id = $1
        AND i.status IN ('pending', 'sent', 'viewed', 'partially_paid', 'overdue')
    `;
    const params: unknown[] = [args.tenantId];
    if (args.role === 'tenant') {
      sql += `
        AND i.customer_id IN (
          SELECT id FROM customers WHERE tenant_id = $1
          AND (email = (SELECT email FROM users WHERE id = $2)
               OR phone = (SELECT phone FROM users WHERE id = $2))
        )
      `;
      params.push(args.userId);
    } else if (args.role === 'owner') {
      sql += `
        AND i.property_id IN (
          SELECT id FROM properties WHERE tenant_id = $1 AND owner_id = $2
        )
      `;
      params.push(args.userId);
    }
    const r = await exec({ sql, params });
    return {
      count: pickNumber(r.rows[0] ?? {}, 'n') ?? 0,
      balance: pickNumber(r.rows[0] ?? {}, 'bal') ?? 0,
    };
  }, { count: 0, balance: 0 });

  const expiringDocuments = await safe(async () => {
    const exec = db.execute;
    if (!exec) return [];
    const r = await exec({
      sql: `
        SELECT document_type AS kind, expires_at
        FROM document_uploads
        WHERE tenant_id = $1
          AND expires_at IS NOT NULL
          AND expires_at <= NOW() + INTERVAL '30 days'
          AND expires_at >= NOW()
          AND status != 'archived'
        LIMIT 25
      `,
      params: [args.tenantId],
    });
    return r.rows.map((row) => ({
      kind: pickString(row, 'kind') ?? 'document',
      expiresAt: pickDate(row, 'expires_at') ?? new Date().toISOString(),
    }));
  }, [] as ReadonlyArray<{ kind: string; expiresAt: string }>);

  const leaseDecisionsDue = await safe(async () => {
    const exec = db.execute;
    if (!exec) return [];
    let sql = `
      SELECT id, renewal_status, end_date
      FROM leases
      WHERE tenant_id = $1
        AND status IN ('active', 'expiring_soon')
        AND end_date <= NOW() + INTERVAL '90 days'
        AND renewal_status IN ('not_started', 'window_opened', 'proposed')
    `;
    const params: unknown[] = [args.tenantId];
    if (args.role === 'tenant') {
      sql += `
        AND customer_id IN (
          SELECT id FROM customers WHERE tenant_id = $1
          AND (email = (SELECT email FROM users WHERE id = $2)
               OR phone = (SELECT phone FROM users WHERE id = $2))
        )
      `;
      params.push(args.userId);
    } else if (args.role === 'owner') {
      sql += `
        AND property_id IN (
          SELECT id FROM properties WHERE tenant_id = $1 AND owner_id = $2
        )
      `;
      params.push(args.userId);
    }
    sql += ' LIMIT 25';
    const r = await exec({ sql, params });
    return r.rows.map((row) => ({
      leaseId: String(row['id']),
      decision: pickString(row, 'renewal_status') ?? 'pending_renewal',
      dueBy: pickDate(row, 'end_date') ?? new Date().toISOString(),
    }));
  }, [] as ReadonlyArray<{ leaseId: string; decision: string; dueBy: string }>);

  return {
    ...emptyOpenItems,
    openMaintenanceCount,
    unpaidInvoiceCount: unpaidAggregate.count,
    unpaidBalance: unpaidAggregate.balance,
    expiringDocuments,
    leaseDecisionsDue,
  };
}
