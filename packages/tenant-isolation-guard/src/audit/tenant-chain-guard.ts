/**
 * tenant-chain-guard — assertion helpers that protect the audit
 * hash chain from cross-tenant `prev_hash` forging.
 *
 * The Borjie audit chain is per-tenant: each tenant maintains its
 * own append-only chain whose `prev_hash` references the previous
 * entry in the SAME tenant's chain. A cross-tenant `prev_hash`
 * (whether accidental or malicious) is an L-CHAIN leak signal.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { getTenantContext } from '../context/tenant-context.js';
import {
  IsolationViolation,
  type TenantId,
} from '../types.js';

export interface AuditChainEntry {
  readonly id: string;
  readonly tenant_id: string;
  readonly prev_hash: string | null;
  readonly hash: string;
  readonly created_at: string;
}

export interface PrevHashLookup {
  /**
   * Return the chain entry with `hash = prevHash`. Implementations
   * MUST filter by tenant_id at the DB layer (RLS does this for
   * us, but the resolver should also pass tenant_id explicitly).
   */
  (prevHash: string, tenantId: TenantId): Promise<AuditChainEntry | null>;
}

/**
 * Assert that the proposed `prev_hash` belongs to the active
 * tenant's chain. Throws IsolationViolation otherwise.
 *
 * For the genesis entry of a tenant's chain `prevHash` is `null`
 * — the assertion is then a no-op.
 */
export async function assertTenantChainContinuity(args: {
  readonly prevHash: string | null;
  readonly lookup: PrevHashLookup;
}): Promise<void> {
  const ctx = getTenantContext();
  if (args.prevHash === null) {
    return;
  }
  const prev = await args.lookup(args.prevHash, ctx.tenantId);
  if (!prev) {
    throw new IsolationViolation({
      layer: 'audit-chain',
      kind: 'cross-tenant-chain-link',
      tenantId: ctx.tenantId,
      message: `prev_hash ${args.prevHash} not found in tenant ${ctx.tenantId} chain (may belong to another tenant)`,
    });
  }
  if (prev.tenant_id !== ctx.tenantId) {
    throw new IsolationViolation({
      layer: 'audit-chain',
      kind: 'cross-tenant-chain-link',
      tenantId: ctx.tenantId,
      observedTenantId: prev.tenant_id as TenantId,
      message: `prev_hash ${args.prevHash} belongs to tenant ${prev.tenant_id} ≠ context ${ctx.tenantId}`,
    });
  }
}

/**
 * Synchronous variant for use cases where prev_hash + its
 * tenant_id are both available without a DB roundtrip
 * (e.g. in-memory chain).
 */
export function assertTenantChainContinuitySync(args: {
  readonly prevHashEntry: AuditChainEntry | null;
}): void {
  const ctx = getTenantContext();
  if (args.prevHashEntry === null) return;
  if (args.prevHashEntry.tenant_id !== ctx.tenantId) {
    throw new IsolationViolation({
      layer: 'audit-chain',
      kind: 'cross-tenant-chain-link',
      tenantId: ctx.tenantId,
      observedTenantId: args.prevHashEntry.tenant_id as TenantId,
      message: `prev entry tenant ${args.prevHashEntry.tenant_id} ≠ context ${ctx.tenantId}`,
    });
  }
}
