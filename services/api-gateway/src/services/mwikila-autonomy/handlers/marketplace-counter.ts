/**
 * Mr. Mwikila handler — marketplace counter-offer.
 *
 * Sees a fresh `request_for_bid_responses` row (buyer counter) or a
 * `marketplace_offers` row → if the counterparty's price is within
 * the delegation envelope (owner-defined target margin), it counters
 * back with the seller's target. Default tier T2 with a 4-hour
 * reversal window — counterparties may rely on the price.
 *
 * Pure-logic shape; ports for open offers + the seller's target
 * margins are injected.
 */

import type { MwikilaHandler, MwikilaHandlerProposal } from '../handler-runtime.js';

export interface OpenOfferRow {
  readonly offerId: string;
  readonly mineralKind: string;
  readonly tonnesRemaining: number;
  readonly buyerPriceTzs: number;
  readonly buyerName: string;
  readonly counterpartyTenantId: string;
}

export interface SellerTargets {
  readonly tenantId: string;
  /**
   * Map of mineral kind → minimum acceptable price per tonne (TZS).
   * If a mineral is missing, the handler skips that offer.
   */
  readonly targetFloorByMineral: Readonly<Record<string, number>>;
  /**
   * The seller's target percentage uplift over the buyer's bid when
   * countering (e.g. 0.05 = 5% above buyer). 0 means counter equal to
   * floor.
   */
  readonly targetUpliftPct: number;
}

export interface MarketplaceCounterPorts {
  listOpenBuyerOffers(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<OpenOfferRow>>;
  getSellerTargets(args: {
    readonly tenantId: string;
  }): Promise<SellerTargets | null>;
  hasAlreadyCountered(args: {
    readonly tenantId: string;
    readonly offerId: string;
  }): Promise<boolean>;
}

export function computeCounterPriceTzs(
  buyerPriceTzs: number,
  floorTzs: number,
  upliftPct: number,
): number {
  const ideal = Math.round(buyerPriceTzs * (1 + upliftPct));
  return Math.max(floorTzs, ideal);
}

export function buildMarketplaceCounterProposal(
  offer: OpenOfferRow,
  counterPriceTzs: number,
  targetUpliftPct: number,
): MwikilaHandlerProposal {
  return {
    actionKind: 'marketplace.counter_offer',
    category: 'marketplace-counters',
    summary: `Counter-offered ${offer.buyerName}: TZS ${counterPriceTzs.toLocaleString()}/tonne for ${offer.tonnesRemaining}t ${offer.mineralKind}.`,
    summarySw: `Rejea ya bei kwa ${offer.buyerName}: TZS ${counterPriceTzs.toLocaleString()}/tani kwa ${offer.tonnesRemaining}t ${offer.mineralKind}.`,
    rationale:
      `Buyer offered TZS ${offer.buyerPriceTzs.toLocaleString()}/tonne; ` +
      `target uplift is ${(targetUpliftPct * 100).toFixed(1)}%; floor enforced ` +
      `from the seller's targetFloorByMineral. Owner can reverse within 4h.`,
    payload: {
      offerId: offer.offerId,
      mineralKind: offer.mineralKind,
      tonnesRemaining: offer.tonnesRemaining,
      buyerPriceTzs: offer.buyerPriceTzs,
      counterPriceTzs,
      counterpartyTenantId: offer.counterpartyTenantId,
      buyerName: offer.buyerName,
    },
    // Marketplace counter-bids do NOT move money — they propose a
    // price. Envelope check still runs because owner may want to cap
    // the size of any single counter-offer. We pass the total
    // counter-offer value as amountTzs.
    amountTzs: counterPriceTzs * offer.tonnesRemaining,
    currency: 'TZS',
    targetRelation: 'counterparty',
  };
}

export function createMarketplaceCounterHandler(
  ports: MarketplaceCounterPorts,
): MwikilaHandler {
  return Object.freeze({
    actionKind: 'marketplace.counter_offer',
    category: 'marketplace-counters',
    async propose({ tenantId }) {
      const offers = await ports.listOpenBuyerOffers({ tenantId });
      if (offers.length === 0) return null;
      const targets = await ports.getSellerTargets({ tenantId });
      if (targets === null) return null;

      for (const offer of offers) {
        const floor = targets.targetFloorByMineral[offer.mineralKind];
        if (floor === undefined) continue;
        const alreadyCountered = await ports.hasAlreadyCountered({
          tenantId,
          offerId: offer.offerId,
        });
        if (alreadyCountered) continue;
        const counterPrice = computeCounterPriceTzs(
          offer.buyerPriceTzs,
          floor,
          targets.targetUpliftPct,
        );
        return buildMarketplaceCounterProposal(
          offer,
          counterPrice,
          targets.targetUpliftPct,
        );
      }
      return null;
    },
  });
}
