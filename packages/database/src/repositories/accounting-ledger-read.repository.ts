/**
 * Accounting ledger READ repository.
 *
 * Reads the REAL payments-ledger journals (`ledger_entries`) for the
 * owner-portal accounting tab. This is a READ-ONLY projection over the
 * canonical double-entry ledger — it does NOT define a parallel ledger and
 * NEVER writes a ledger line (the money path stays on LedgerService.post(),
 * CLAUDE.md hard rule). It simply SELECTs already-posted lines, newest first,
 * scoped to the tenant (enforced by RLS on the pinned connection) and,
 * optionally, to a single site.
 *
 * Site scoping
 * ------------
 * `ledger_entries` carries no `site_id` column — the per-line site linkage
 * lives in `metadata->>'siteId'` (stamped by the mining money-post paths) with
 * a legacy fallback on `property_id`. When `siteId` is supplied we predicate on
 * either, so both linkage conventions are honoured. When absent, all the
 * tenant's lines are returned.
 *
 * Money model (CLAUDE.md): `amount_minor_units` / `balance_after_minor_units`
 * are BIGINT minor units; `currency` (ISO-4217) is returned per line so the
 * renderer threads it into formatCurrency(amount, code) — never a hardcoded
 * literal.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { ledgerEntries } from '../schemas/payments-ledger.schema.js';

/** One journal line as the accounting tab renders it. */
export interface AccountingLedgerLine {
  readonly id: string;
  readonly journalId: string;
  readonly accountId: string;
  readonly type: string;
  readonly direction: string;
  /** BIGINT minor units — renderer threads `currency` into formatCurrency. */
  readonly amountMinorUnits: number;
  readonly balanceAfterMinorUnits: number;
  readonly currency: string;
  readonly effectiveDate: Date;
  readonly postedAt: Date;
  readonly description: string | null;
  readonly paymentIntentId: string | null;
}

export interface ListLedgerOptions {
  /** Restrict to a single site (matches metadata->>'siteId' OR property_id). */
  readonly siteId?: string;
  /** Inclusive lower bound on `posted_at`. */
  readonly from?: Date;
  /** Exclusive upper bound on `posted_at`. */
  readonly to?: Date;
  readonly limit?: number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * List the tenant's posted journal lines, newest first. Runs on the passed
 * Drizzle client — the gateway passes the RLS-pinned request client, so
 * tenant isolation is enforced by RLS; the `eq(tenant_id, …)` predicate is
 * belt-and-braces.
 */
export async function listLedgerLines(
  db: DatabaseClient,
  tenantId: string,
  opts: ListLedgerOptions = {},
): Promise<AccountingLedgerLine[]> {
  const limit = clampLimit(opts.limit);
  const conds = [eq(ledgerEntries.tenantId, tenantId)];

  if (opts.siteId) {
    // Site linkage: metadata->>'siteId' (canonical) OR legacy property_id.
    conds.push(
      sql`(${ledgerEntries.metadata}->>'siteId' = ${opts.siteId} OR ${ledgerEntries.propertyId} = ${opts.siteId})`,
    );
  }
  if (opts.from) {
    conds.push(sql`${ledgerEntries.postedAt} >= ${opts.from.toISOString()}`);
  }
  if (opts.to) {
    conds.push(sql`${ledgerEntries.postedAt} < ${opts.to.toISOString()}`);
  }

  const rows = await db
    .select({
      id: ledgerEntries.id,
      journalId: ledgerEntries.journalId,
      accountId: ledgerEntries.accountId,
      type: ledgerEntries.type,
      direction: ledgerEntries.direction,
      amountMinorUnits: ledgerEntries.amountMinorUnits,
      balanceAfterMinorUnits: ledgerEntries.balanceAfterMinorUnits,
      currency: ledgerEntries.currency,
      effectiveDate: ledgerEntries.effectiveDate,
      postedAt: ledgerEntries.postedAt,
      description: ledgerEntries.description,
      paymentIntentId: ledgerEntries.paymentIntentId,
    })
    .from(ledgerEntries)
    .where(and(...conds))
    .orderBy(desc(ledgerEntries.postedAt), desc(ledgerEntries.sequenceNumber))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    journalId: r.journalId,
    accountId: r.accountId,
    type: r.type,
    direction: r.direction,
    amountMinorUnits: Number(r.amountMinorUnits),
    balanceAfterMinorUnits: Number(r.balanceAfterMinorUnits),
    currency: r.currency,
    effectiveDate: r.effectiveDate,
    postedAt: r.postedAt,
    description: r.description ?? null,
    paymentIntentId: r.paymentIntentId ?? null,
  }));
}
