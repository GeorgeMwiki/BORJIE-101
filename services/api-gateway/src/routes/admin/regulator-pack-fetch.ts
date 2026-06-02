/**
 * Regulator-pack source fetcher — reads the four tenant-scoped corpora that
 * make up a regulator pack (WS-5, task 2).
 *
 * CROSS-TENANT RLS NOTE (security-critical):
 * The admin approving the export operates from their OWN tenant GUC (bound by
 * databaseMiddleware on a RESERVED connection). The export TARGET is a
 * DIFFERENT tenant, so we re-bind `app.current_tenant_id` to the target tenant
 * on that same reserved connection before reading. This keeps the DB's FORCE-RLS
 * the single source of isolation (we never disable RLS or double-filter in app
 * code — CLAUDE.md): the connection sees exactly ONE tenant at a time, and the
 * reserved connection's GUC is reset on request release (see withReservedConnection).
 *
 * The fetch is bounded (LIMIT per section) so a pathological tenant cannot make
 * the export unbounded; counts in the bundle reflect what was included.
 */

import { sql, and, eq, gte, lte, desc } from 'drizzle-orm';
import {
  AuditEvents,
  regulatoryFilings,
  complianceExports,
  aiAuditChain,
} from '@borjie/database';
import type {
  RegulatorPackSources,
  EvidenceChainEntry,
} from './regulator-pack';

// The bare `auditEvents` export from the @borjie/database barrel resolves to
// the LEGACY tenant.schema table (occurred_at, no timestamp_ms). The richer
// audit log we want (timestamp_ms + outcome + category) is exposed only via
// the `AuditEvents` namespace to avoid that name collision — pull it here.
const auditEvents = AuditEvents.auditEvents;

/** Hard ceiling per section — keeps an export bounded + memory-safe. */
const SECTION_LIMIT = 5000;

export interface RegulatorPackPeriod {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Re-bind the reserved connection's tenant GUC to the export target, then read
 * the four corpora. Returns the raw rows shaped for `buildRegulatorPack`.
 *
 * `db` MUST be the request-scoped reserved-connection client (`c.get('db')`)
 * so the GUC re-bind sticks for the subsequent reads on the same connection.
 */
export async function fetchRegulatorPackSources(
  db: any,
  targetTenantId: string,
  period: RegulatorPackPeriod,
): Promise<RegulatorPackSources> {
  // Bind RLS to the TARGET tenant for the duration of these reads.
  await db.execute(
    sql`SELECT set_config('app.current_tenant_id', ${targetTenantId}, false)`,
  );

  const startMs = period.start.getTime();
  const endMs = period.end.getTime();

  // §1 — audit_events (timestampMs is an integer column).
  const auditRows = (await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, targetTenantId),
        gte(auditEvents.timestampMs, startMs),
        lte(auditEvents.timestampMs, endMs),
      ),
    )
    .orderBy(desc(auditEvents.timestampMs))
    .limit(SECTION_LIMIT)) as Array<Record<string, unknown>>;

  // §2 — regulatory_filings (due_at within the period).
  const filingRows = (await db
    .select()
    .from(regulatoryFilings)
    .where(
      and(
        eq(regulatoryFilings.tenantId, targetTenantId),
        gte(regulatoryFilings.dueAt, period.start),
        lte(regulatoryFilings.dueAt, period.end),
      ),
    )
    .orderBy(desc(regulatoryFilings.dueAt))
    .limit(SECTION_LIMIT)) as Array<Record<string, unknown>>;

  // §3 — compliance_exports (export runs whose period overlaps).
  const exportRows = (await db
    .select()
    .from(complianceExports)
    .where(
      and(
        eq(complianceExports.tenantId, targetTenantId),
        lte(complianceExports.periodStart, period.end),
        gte(complianceExports.periodEnd, period.start),
      ),
    )
    .orderBy(desc(complianceExports.createdAt))
    .limit(SECTION_LIMIT)) as Array<Record<string, unknown>>;

  // §4 — ai_audit_chain (the hash-chained evidence; ordered by sequence so the
  // continuity check can verify the prevHash links).
  const chainRows = (await db
    .select()
    .from(aiAuditChain)
    .where(
      and(
        eq(aiAuditChain.tenantId, targetTenantId),
        gte(aiAuditChain.createdAt, period.start),
        lte(aiAuditChain.createdAt, period.end),
      ),
    )
    .orderBy(aiAuditChain.sequenceId)
    .limit(SECTION_LIMIT)) as Array<Record<string, unknown>>;

  const evidenceChain: EvidenceChainEntry[] = chainRows.map((r) => ({
    sequenceId: Number(r.sequenceId ?? 0),
    thisHash: String(r.thisHash ?? ''),
    prevHash: String(r.prevHash ?? ''),
    action: String(r.action ?? ''),
    turnId: r.turnId,
    createdAt: r.createdAt,
  }));

  return {
    auditEvents: auditRows,
    regulatoryFilings: filingRows,
    complianceExports: exportRows,
    evidenceChain,
  };
}
