/**
 * Settlement orchestrator — commercial chain L8.
 *
 * Drives the end-to-end "buyer signs delivery → ledger journal → seller
 * payout" loop. The orchestrator is the SOLE money-mutating path for
 * RFB settlements; the CLAUDE.md hard rule "Money MUST go through
 * LedgerService.post()" is satisfied by the settlement ledger port.
 *
 * Flow per signDelivery():
 *   1. Cross-tenant idempotency check on (tenant, response, checksum).
 *      Replays return the existing row with `idempotent: true`.
 *   2. Load the response + parent RFB inside the SELLER's RLS scope.
 *   3. Compute gross / royalty / fee / net (TZS).
 *   4. INSERT settlements row with status='pending'.
 *   5. LedgerService.post() via the port. Stamp ledger_txn_id +
 *      status='posted'. A failure here marks the row 'failed' and
 *      throws — no payout fires.
 *   6. Payout via the port (M-Pesa B2C by default; wallet for sellers
 *      with a Borjie wallet credit). Stamp provider + provider_ref +
 *      status='paying_out'. Best-effort: payout failure stays
 *      'posted' so a background retry can pick it up.
 *   7. Emit a cockpit `mwikila.acted`-shaped event so the owner sees
 *      the live settlement landing (re-used to avoid a fresh kind).
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { createLogger } from '../../utils/logger';
import { publishCockpitEvent } from '../cockpit-events';
import { enqueueRfbFulfillmentNotification } from '../buyer-notifications';
import {
  computeSettlementMath,
  type SettlementLedgerPort,
  type SettlementPayoutPort,
  type SettlementMath,
  type SignDeliveryInput,
  type SignDeliveryResult,
  type SettlementStatus,
  type PayoutProvider,
} from './types';

const moduleLogger = createLogger('settlement-orchestrator');

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

export interface SettlementOrchestratorDeps {
  readonly db: DbExecutor;
  readonly ledgerPort: SettlementLedgerPort;
  readonly payoutPort: SettlementPayoutPort;
}

export class SettlementOrchestrator {
  private readonly db: DbExecutor;
  private readonly ledgerPort: SettlementLedgerPort;
  private readonly payoutPort: SettlementPayoutPort;

  constructor(deps: SettlementOrchestratorDeps) {
    this.db = deps.db;
    this.ledgerPort = deps.ledgerPort;
    this.payoutPort = deps.payoutPort;
  }

  async signDelivery(input: SignDeliveryInput): Promise<SignDeliveryResult> {
    const { tenantId, buyerUserId, responseId, coCStepChecksum } = input;

    // ---- step 1: idempotency lookup -----------------------------------
    const existing = rowsOf(
      await this.db.execute(sql`
        SELECT id::text AS id,
               status,
               gross_tzs::text AS gross_tzs,
               royalty_tzs::text AS royalty_tzs,
               fee_tzs::text AS fee_tzs,
               net_tzs::text AS net_tzs,
               ledger_txn_id,
               payout_provider,
               payout_provider_ref
          FROM settlements
         WHERE tenant_id = ${tenantId}::uuid
           AND response_id = ${responseId}::uuid
           AND idempotency_key = ${coCStepChecksum}
         LIMIT 1
      `),
    )[0];

    if (existing) {
      const math: SettlementMath = {
        grossTzs: Number(existing.gross_tzs ?? 0),
        royaltyTzs: Number(existing.royalty_tzs ?? 0),
        feeTzs: Number(existing.fee_tzs ?? 0),
        netTzs: Number(existing.net_tzs ?? 0),
      };
      return {
        settlementId: String(existing.id),
        status: (existing.status ?? 'pending') as SettlementStatus,
        math,
        ledgerTxnId: (existing.ledger_txn_id as string | null) ?? null,
        payoutProvider:
          (existing.payout_provider as PayoutProvider | null) ?? null,
        payoutProviderRef:
          (existing.payout_provider_ref as string | null) ?? null,
        idempotent: true,
      };
    }

    // ---- step 2: load response + parent RFB --------------------------
    const respRows = rowsOf(
      await this.db.execute(sql`
        SELECT
          r.id::text AS response_id,
          r.rfb_id::text AS rfb_id,
          r.tenant_id::text AS tenant_id,
          r.seller_id AS seller_id,
          r.offered_tonnage::text AS offered_tonnage,
          r.offered_price_tzs::text AS offered_price_tzs,
          rfb.mineral_kind,
          rfb.buyer_id,
          rfb.tenant_id::text AS buyer_tenant_id
          FROM request_for_bid_responses r
          JOIN request_for_bids rfb ON rfb.id = r.rfb_id
         WHERE r.id = ${responseId}::uuid
         LIMIT 1
      `),
    )[0];

    if (!respRows) {
      throw new SettlementError(
        'RESPONSE_NOT_FOUND',
        `Response ${responseId} not found in tenant ${tenantId}`,
      );
    }
    if (String(respRows.tenant_id) !== tenantId) {
      // Cross-tenant attempt — refuse loudly. The buyer's tenant should
      // equal the response's tenant for sign-delivery.
      throw new SettlementError(
        'CROSS_TENANT_BLOCKED',
        `Response ${responseId} belongs to a different tenant`,
      );
    }
    if (String(respRows.buyer_id) !== buyerUserId) {
      throw new SettlementError(
        'UNAUTHORIZED_BUYER',
        `User ${buyerUserId} is not the buyer for RFB ${respRows.rfb_id}`,
      );
    }

    // ---- step 3: compute math ----------------------------------------
    const math = computeSettlementMath({
      offeredTonnage: Number(respRows.offered_tonnage ?? 0),
      offeredPriceTzs: Number(respRows.offered_price_tzs ?? 0),
      mineralKind: String(respRows.mineral_kind ?? 'unknown'),
    });

    // ---- step 4: INSERT settlements row ------------------------------
    const settlementId = randomUUID();
    await this.db.execute(sql`
      INSERT INTO settlements (
        id, tenant_id, rfb_id, response_id,
        gross_tzs, royalty_tzs, fee_tzs, net_tzs,
        status, idempotency_key, created_at
      ) VALUES (
        ${settlementId}::uuid,
        ${tenantId}::uuid,
        ${String(respRows.rfb_id)}::uuid,
        ${responseId}::uuid,
        ${math.grossTzs}, ${math.royaltyTzs}, ${math.feeTzs}, ${math.netTzs},
        'pending',
        ${coCStepChecksum},
        NOW()
      )
    `);

    // ---- step 5: LedgerService.post() via port -----------------------
    let ledgerTxnId: string;
    try {
      const ledgerRes = await this.ledgerPort.post({
        tenantId,
        responseId,
        idempotencyKey: coCStepChecksum,
        math,
      });
      ledgerTxnId = ledgerRes.journalId;
      await this.db.execute(sql`
        UPDATE settlements
           SET status = 'posted', ledger_txn_id = ${ledgerTxnId}
         WHERE id = ${settlementId}::uuid
      `);
    } catch (err) {
      moduleLogger.error(
        { err, tenantId, settlementId, responseId },
        'settlement_ledger_post_failed',
      );
      await this.db.execute(sql`
        UPDATE settlements
           SET status = 'failed'
         WHERE id = ${settlementId}::uuid
      `);
      throw new SettlementError(
        'LEDGER_POST_FAILED',
        err instanceof Error ? err.message : 'ledger.post threw',
      );
    }

    // ---- step 6: payout via port (best-effort) -----------------------
    let payoutProvider: PayoutProvider | null = null;
    let payoutProviderRef: string | null = null;
    let finalStatus: SettlementStatus = 'posted';
    try {
      const payoutRes = await this.payoutPort.payout({
        tenantId,
        settlementId,
        netTzs: math.netTzs,
        sellerUserId: String(respRows.seller_id ?? ''),
      });
      payoutProvider = payoutRes.provider;
      payoutProviderRef = payoutRes.providerRef;
      finalStatus = 'paying_out';
      await this.db.execute(sql`
        UPDATE settlements
           SET status = 'paying_out',
               payout_provider = ${payoutProvider},
               payout_provider_ref = ${payoutProviderRef}
         WHERE id = ${settlementId}::uuid
      `);
    } catch (err) {
      moduleLogger.warn(
        { err, tenantId, settlementId },
        'settlement_payout_failed_will_retry',
      );
      // Status stays 'posted'; background payout retry picks it up.
    }

    // ---- step 7: cockpit event + buyer notification ------------------
    try {
      publishCockpitEvent({
        kind: 'opportunity.scan_completed',
        tenantId,
        emittedAt: new Date().toISOString(),
        opportunityCount: 0,
        topExpectedValueTzs: math.netTzs,
      });
    } catch (err) {
      moduleLogger.warn(
        { err, tenantId, settlementId },
        'settlement_cockpit_event_failed',
      );
    }

    // L8 → L7 fan-out: also tell the buyer the settlement landed. We
    // re-use the rfb_fulfilled notification kind because that's the
    // semantic event the buyer cares about. Best-effort.
    try {
      await enqueueRfbFulfillmentNotification(this.db, {
        buyerTenantId: String(respRows.buyer_tenant_id),
        buyerUserId,
        sellerTenantId: tenantId,
        rfbId: String(respRows.rfb_id),
        responseId,
        mineralKind: String(respRows.mineral_kind ?? 'mineral'),
        tonnage: Number(respRows.offered_tonnage ?? 0),
        extraPayload: {
          settlementId,
          ledgerTxnId,
          netTzs: math.netTzs,
        },
      });
    } catch (err) {
      moduleLogger.warn(
        { err, settlementId },
        'settlement_buyer_notification_failed',
      );
    }

    moduleLogger.info(
      {
        settlementId,
        tenantId,
        responseId,
        rfbId: respRows.rfb_id,
        math,
        ledgerTxnId,
        payoutProvider,
        finalStatus,
      },
      'settlement_initiated',
    );

    return {
      settlementId,
      status: finalStatus,
      math,
      ledgerTxnId,
      payoutProvider,
      payoutProviderRef,
      idempotent: false,
    };
  }

  /**
   * List the seller-side settlements for the current tenant. Used by
   * the owner cockpit and the `owner.settlement.list_mine` brain tool.
   */
  async listForTenant(input: {
    readonly tenantId: string;
    readonly limit?: number;
  }): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly rfbId: string;
      readonly responseId: string;
      readonly status: SettlementStatus;
      readonly grossTzs: number;
      readonly royaltyTzs: number;
      readonly feeTzs: number;
      readonly netTzs: number;
      readonly payoutProvider: PayoutProvider | null;
      readonly payoutProviderRef: string | null;
      readonly createdAt: string;
    }>
  > {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = rowsOf(
      await this.db.execute(sql`
        SELECT id::text AS id,
               rfb_id::text AS rfb_id,
               response_id::text AS response_id,
               status,
               gross_tzs::text AS gross_tzs,
               royalty_tzs::text AS royalty_tzs,
               fee_tzs::text AS fee_tzs,
               net_tzs::text AS net_tzs,
               payout_provider,
               payout_provider_ref,
               created_at
          FROM settlements
         WHERE tenant_id = ${input.tenantId}::uuid
         ORDER BY created_at DESC
         LIMIT ${limit}
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      rfbId: String(r.rfb_id),
      responseId: String(r.response_id),
      status: (r.status ?? 'pending') as SettlementStatus,
      grossTzs: Number(r.gross_tzs ?? 0),
      royaltyTzs: Number(r.royalty_tzs ?? 0),
      feeTzs: Number(r.fee_tzs ?? 0),
      netTzs: Number(r.net_tzs ?? 0),
      payoutProvider: (r.payout_provider as PayoutProvider | null) ?? null,
      payoutProviderRef: (r.payout_provider_ref as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  }
}

export class SettlementError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SettlementError';
  }
}
