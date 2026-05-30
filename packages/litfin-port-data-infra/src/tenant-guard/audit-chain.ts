/**
 * Audit-chain continuity guard.
 *
 * Borjie's append-only audit ledger links each entry to the prior
 * one via `prev_hash`. Without a tenant check, a malicious or buggy
 * caller could chain a new entry onto another tenant's last hash
 * (e.g. to obscure history or escalate). This guard refuses any
 * append whose `prev_hash` does not resolve to the same tenant.
 *
 * The `lookup` parameter is caller-supplied so this module stays
 * driver-free. Two flavours:
 *   - async `assertTenantChainContinuity` for production
 *   - sync `assertTenantChainContinuitySync` for unit tests / paths
 *     that pre-fetch the previous entry from an in-memory ring
 *
 * Ported verbatim from @litfin/tenant-guard. Borjie's native
 * audit-hash-chain package gates the same way at insert time; this
 * is a pure-function pre-check usable inside services without a
 * Drizzle round-trip.
 */

import { getTenantContext } from "./context";
import { IsolationViolation } from "./types";

export interface ChainEntryLike {
  readonly hash: string;
  readonly tenant_id: string;
}

export interface AuditChainLookup {
  (prevHash: string): Promise<ChainEntryLike | null>;
}

export async function assertTenantChainContinuity(args: {
  readonly prevHash: string | null;
  readonly lookup: AuditChainLookup;
}): Promise<void> {
  if (!args.prevHash) return; // genesis entry has no predecessor
  const ctx = getTenantContext();
  const prev = await args.lookup(args.prevHash);
  if (!prev) {
    throw new IsolationViolation({
      layer: "audit",
      kind: "audit-chain-break",
      expectedTenantId: ctx.tenantId,
      hint: `prev_hash ${args.prevHash.slice(0, 12)}… not found`,
    });
  }
  if (prev.tenant_id !== ctx.tenantId) {
    throw new IsolationViolation({
      layer: "audit",
      kind: "audit-chain-break",
      observedTenantId: prev.tenant_id,
      expectedTenantId: ctx.tenantId,
      hint: `prev_hash ${args.prevHash.slice(0, 12)}… belongs to another tenant`,
    });
  }
}

export function assertTenantChainContinuitySync(args: {
  readonly prevHashEntry: ChainEntryLike | null;
}): void {
  if (!args.prevHashEntry) return;
  const ctx = getTenantContext();
  if (args.prevHashEntry.tenant_id !== ctx.tenantId) {
    throw new IsolationViolation({
      layer: "audit",
      kind: "audit-chain-break",
      observedTenantId: args.prevHashEntry.tenant_id,
      expectedTenantId: ctx.tenantId,
      hint: "prev_hash entry belongs to another tenant",
    });
  }
}
