/**
 * Bank EFT placeholder adapter — FAILS LOUD.
 *
 * The real EFT integration is bank-by-bank — KCB, NCBA, Equity all
 * expose different APIs (NACHA-style files, RTGS/EFT, SWIFT). The
 * platform's Phase E strategy is to swap this adapter for a per-
 * jurisdiction EFT MCP server (TZ: Selcom; KE: Pesalink/Cellulant;
 * UG: Eversend; RW: BK Connect; ZA: Stitch / Yapily Pay; NG: NIBSS).
 * Each MCP server speaks the local bank rail and the composition root
 * routes tenants to the right one via `tenants.region` (migration 0158).
 *
 * Region routing (W1.5 / DA3):
 *   - The factory accepts an optional `regionResolver` closure that
 *     calls `getTenantRegion(db, tenantId)` from `@borjie/database`.
 *     This resolver returns the tenant's `tenantRegion` (the value
 *     of `tenants.region`, e.g. `'af-south-1'`) or `null` if the row
 *     is unprovisioned.
 *   - On every `send()` we resolve `tenantRegion` from the row's
 *     `tenantId`. If `getTenantRegion` returns null (unprovisioned
 *     tenant or DB outage) we fall back to `env.AWS_REGION`. The
 *     resolved `tenantRegion` is surfaced in the loud-refusal error
 *     message so operators can see at a glance which MCP server
 *     SHOULD have been routed to.
 *   - When the real EFT MCP server lands, the region-routed dispatch
 *     hook is already in place (`pickEftRailForRegion(tenantRegion)`);
 *     only the inner adapter swap is left.
 *
 * Until that wiring lands, this adapter REFUSES to accept any transfer
 * at all. Previously it returned `{ status: 'failed', failureReason:
 * 'eft_not_implemented' }` which the worker treated as a retryable
 * failure — but that left rows queued for retry forever and gave
 * operators a noisy DLQ rather than a single sharp signal at config
 * time. Throwing a typed `NotConfiguredError` at factory call surfaces
 * the gap at composition root, not at runtime.
 */

import type {
  PayoutProvider,
  PayoutProviderInput,
  PayoutProviderResult,
} from '../stub-payout-provider';
import { logger } from '../../../utils/logger.js';

/**
 * Closure that resolves the tenant's data-residency region from
 * `tenants.region`. Provided by the composition root so this adapter
 * stays free of an `@borjie/database` structural dep.
 *
 * Returns `null` for unprovisioned tenants or DB errors; callers fall
 * back to `env.AWS_REGION`.
 */
export type TenantRegionResolver = (
  tenantId: string,
) => Promise<string | null>;

export type EftStubConfig = {
  /** ISO-4217 currencies this provider is authoritative for. */
  readonly supportedCurrencies?: ReadonlyArray<string>;
  /**
   * Resolves `tenants.region` for the supplied `tenantId`. When omitted
   * the adapter degrades to `env.AWS_REGION` for every row. Supplying
   * a resolver is required for any deployment that serves tenants
   * across more than one data-residency region (TZ PDPA + KE DPA +
   * ZA POPIA + NG NDPR).
   */
  readonly regionResolver?: TenantRegionResolver;
  /**
   * Fallback region when the resolver returns null. Defaults to
   * `process.env.AWS_REGION`. Exposed as a config field so tests can
   * inject a deterministic value without mutating process.env.
   */
  readonly defaultRegion?: string;
};

/**
 * Thrown when the EFT adapter is constructed in any non-test environment.
 * Composition root must wire a per-jurisdiction MCP-backed provider
 * (Selcom / Pesalink / Eversend / etc.) before payouts are accepted.
 */
export class EftNotConfiguredError extends Error {
  readonly code = 'EFT_NOT_CONFIGURED';
  constructor(message?: string) {
    super(
      message ??
        'EFT bank-rail adapter is not configured. Phase E composition must bind a per-jurisdiction EFT MCP server (TZ: Selcom; KE: Pesalink/Cellulant; UG: Eversend; RW: BK Connect; ZA: Stitch; NG: NIBSS). This stub refuses to send.',
    );
    this.name = 'EftNotConfiguredError';
  }
}

/**
 * Resolves the region for a given payout row. Pure helper exported for
 * tests so the dispatch logic can be exercised without constructing the
 * full adapter (mirrors `resolveRegionAndKey` in the encryption barrel).
 */
export async function resolveEftRegion(
  tenantId: string,
  config: EftStubConfig,
): Promise<string | null> {
  let resolved: string | null = null;
  if (config.regionResolver && tenantId.length > 0) {
    try {
      resolved = await config.regionResolver(tenantId);
    } catch {
      // Degrade — fall through to env.AWS_REGION fallback below.
      resolved = null;
    }
  }
  if (resolved && resolved.length > 0) {
    return resolved;
  }
  const fallback =
    config.defaultRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    null;
  return fallback && fallback.length > 0 ? fallback : null;
}

export function createEftStubAdapter(config: EftStubConfig = {}): PayoutProvider {
  // Allow construction in tests so unit tests can still assert the
  // `send` refusal. In any other environment, construction itself is
  // the loud signal: operators see the misconfiguration at boot.
  if (process.env.NODE_ENV !== 'test') {
    logger.error('[eft-stub-adapter] constructed outside test env — payouts via this adapter will refuse. Wire a real EFT MCP server (see Phase E composition).');
  }

  async function send(input: PayoutProviderInput): Promise<PayoutProviderResult> {
    // Validate the input shape so reconciliation tooling can still
    // distinguish invalid proposals from "no rail configured" — but
    // every successful validation still terminates in a typed refusal.
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
      return {
        providerRef: `eft_invalid_${input.idempotencyKey}`,
        status: 'failed',
        failureReason: 'eft_invalid_amount',
      };
    }
    if (typeof input.destination !== 'string' || input.destination.trim().length === 0) {
      return {
        providerRef: `eft_invalid_dest_${input.idempotencyKey}`,
        status: 'failed',
        failureReason: 'eft_missing_destination',
      };
    }
    // Resolve the region BEFORE refusing so the error message surfaces
    // the tenant's home region. When the real EFT MCP server lands
    // this branch picks the per-jurisdiction adapter (Selcom for
    // af-east-1 / TZ, Pesalink for af-south-1 / KE, etc.).
    const region = await resolveEftRegion(input.tenantId, config);
    const regionTag = region ?? 'unknown-region';
    // Loud refusal: thrown errors propagate to the payout worker which
    // marks the row as `dead_letter` immediately rather than burning
    // retry budget. Operators see one sharp signal per tenant rather
    // than a slow DLQ accumulation.
    throw new EftNotConfiguredError(
      `Refusing EFT payout for tenant ${input.tenantId} (${input.amountMinor} ${input.currency}, region=${regionTag}) — no bank rail bound. See Phase E composition.`,
    );
  }

  return { send };
}
