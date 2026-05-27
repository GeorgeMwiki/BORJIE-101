/**
 * `createBuyerMarketplaceAdvisor` — composes the four feature modules
 * (recommend / KYC / payment / ETA) behind a single dep-injected
 * advisor object.
 *
 * The factory accepts ports for mine catalog, KYC source, and
 * logistics; defaults provide in-memory adapters when callers want a
 * lightweight wiring (tests, local dev).
 */

import { UnknownBuyerError } from './errors.js';
import {
  createInMemoryKycSource,
  createInMemoryLogistics,
  createInMemoryMineCatalog,
  NOOP_LOGGER,
  type KycSourcePort,
  type Logger,
  type LogisticsPort,
  type MineCatalogPort,
} from './ports.js';
import { estimateEtaFor } from './eta-estimate.js';
import { scoreKyc } from './kyc-risk.js';
import { proposeTerms } from './payment-terms.js';
import { rankMines } from './recommend-mines.js';
import {
  buyerNeedSchema,
  etaEstimateInputSchema,
  paymentTermProposalInputSchema,
  type BuyerNeed,
  type EtaEstimate,
  type EtaEstimateInput,
  type KycRiskReport,
  type MineRecommendation,
  type PaymentTermProposal,
  type PaymentTermProposalInput,
} from './types.js';

export interface BuyerMarketplaceAdvisorDeps {
  readonly mineCatalog?: MineCatalogPort;
  readonly kycSource?: KycSourcePort;
  readonly logistics?: LogisticsPort;
  readonly logger?: Logger;
}

export interface BuyerMarketplaceAdvisor {
  recommendMines(input: BuyerNeed): Promise<ReadonlyArray<MineRecommendation>>;
  assessKycRisk(buyerId: string, tenantId: string): Promise<KycRiskReport>;
  proposePaymentTerms(
    input: PaymentTermProposalInput,
  ): Promise<PaymentTermProposal>;
  estimateEta(input: EtaEstimateInput): Promise<EtaEstimate>;
}

export function createBuyerMarketplaceAdvisor(
  deps: BuyerMarketplaceAdvisorDeps = {},
): BuyerMarketplaceAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  const mineCatalog = deps.mineCatalog ?? createInMemoryMineCatalog([]);
  const kycSource = deps.kycSource ?? createInMemoryKycSource([]);
  const logistics = deps.logistics ?? createInMemoryLogistics([]);

  return {
    async recommendMines(rawNeed) {
      const need = buyerNeedSchema.parse(rawNeed);
      logger.info('buyer-advisor.recommend.start', {
        buyerId: need.buyerId,
        tenantId: need.tenantId,
        commodity: need.commodity,
      });
      const mines = await mineCatalog.listMines({
        tenantId: need.tenantId,
        commodity: need.commodity,
      });
      const ranked = rankMines(need, mines);
      logger.info('buyer-advisor.recommend.done', {
        candidates: mines.length,
        ranked: ranked.length,
      });
      return ranked;
    },

    async assessKycRisk(buyerId, tenantId) {
      if (!buyerId || !tenantId) {
        throw new UnknownBuyerError(buyerId, tenantId);
      }
      const facts = await kycSource.fetchKycFacts({ buyerId, tenantId });
      if (!facts) {
        throw new UnknownBuyerError(buyerId, tenantId);
      }
      const report = scoreKyc(facts);
      logger.info('buyer-advisor.kyc.done', {
        buyerId,
        tenantId,
        band: report.band,
        score: report.score,
      });
      return report;
    },

    async proposePaymentTerms(rawInput) {
      const input = paymentTermProposalInputSchema.parse(rawInput);
      const proposal = proposeTerms(input);
      logger.info('buyer-advisor.payment-terms.done', {
        buyerId: input.buyerId,
        tenantId: input.tenantId,
        primary: proposal.primary,
      });
      return proposal;
    },

    async estimateEta(rawInput) {
      const input = etaEstimateInputSchema.parse(rawInput);
      const estimate = await estimateEtaFor(input, logistics);
      logger.info('buyer-advisor.eta.done', {
        originMineId: input.originMineId,
        destPort: input.destPort,
        days: estimate.days,
      });
      return estimate;
    },
  };
}
