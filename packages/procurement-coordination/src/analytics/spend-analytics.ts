/**
 * Spend + vendor analytics.
 *
 * Pure aggregation over the persisted PO / invoice / vendor / framework
 * records. The functions take the data port as input so they can run
 * against either the in-memory test store or the Postgres adapter.
 *
 * Maverick-spend detection flags POs that should have routed through
 * a framework agreement or RFQ but didn't — a typical estate-ops
 * leakage signal.
 */

import type {
  CurrencyCode,
  FrameworkAgreement,
  MaverickSpendItem,
  ProcurementDataPort,
  PurchaseOrder,
  SpendByCategory,
  SpendByVendor,
  Vendor,
  VendorCategory,
  VendorId,
  VendorPerformance,
} from '../types.js';

export interface SpendAnalyticsService {
  spendByCategory(args: { readonly tenantId: string }): Promise<ReadonlyArray<SpendByCategory>>;
  spendByVendor(args: { readonly tenantId: string }): Promise<ReadonlyArray<SpendByVendor>>;
  topVendors(args: { readonly tenantId: string; readonly topN: number }): Promise<ReadonlyArray<SpendByVendor>>;
  vendorPerformance(args: { readonly tenantId: string }): Promise<ReadonlyArray<VendorPerformance>>;
  detectMaverickSpend(args: {
    readonly tenantId: string;
    readonly singleBidHighValueThreshold?: number;
  }): Promise<ReadonlyArray<MaverickSpendItem>>;
  /**
   * Suggest framework-agreement candidates — vendors with multiple
   * POs across the period but no active framework.
   */
  suggestFrameworkCandidates(args: { readonly tenantId: string }): Promise<
    ReadonlyArray<{
      readonly vendorId: VendorId;
      readonly vendorName: string;
      readonly poCount: number;
      readonly amount: number;
      readonly currency: CurrencyCode;
    }>
  >;
}

export interface SpendAnalyticsDeps {
  readonly dataPort: ProcurementDataPort;
}

export function createSpendAnalytics(deps: SpendAnalyticsDeps): SpendAnalyticsService {
  const port = deps.dataPort;

  return {
    async spendByCategory(args) {
      const pos = await port.listPos(args.tenantId);
      const vendors = await port.listVendors(args.tenantId);
      const byCategory = new Map<VendorCategory, { amount: number; count: number; currency: CurrencyCode }>();
      for (const po of poInFlight(pos)) {
        const vendor = vendors.find((v) => v.id === po.vendorId);
        const cat = vendor?.categories[0] ?? ('professional_services' as VendorCategory);
        const prev = byCategory.get(cat) ?? { amount: 0, count: 0, currency: po.currency };
        byCategory.set(cat, {
          amount: prev.amount + po.total,
          count: prev.count + 1,
          currency: prev.currency,
        });
      }
      return Array.from(byCategory.entries())
        .map(([category, v]) => ({
          category,
          amount: round2(v.amount),
          currency: v.currency,
          poCount: v.count,
        }))
        .sort((a, b) => b.amount - a.amount);
    },

    async spendByVendor(args) {
      const pos = await port.listPos(args.tenantId);
      const vendors = await port.listVendors(args.tenantId);
      const byVendor = new Map<VendorId, { amount: number; count: number; currency: CurrencyCode }>();
      for (const po of poInFlight(pos)) {
        const prev = byVendor.get(po.vendorId) ?? { amount: 0, count: 0, currency: po.currency };
        byVendor.set(po.vendorId, {
          amount: prev.amount + po.total,
          count: prev.count + 1,
          currency: prev.currency,
        });
      }
      return Array.from(byVendor.entries())
        .map(([vendorId, v]) => ({
          vendorId,
          vendorName: vendors.find((vv) => vv.id === vendorId)?.companyName ?? vendorId,
          amount: round2(v.amount),
          currency: v.currency,
          poCount: v.count,
          avgPoValue: round2(v.amount / v.count),
        }))
        .sort((a, b) => b.amount - a.amount);
    },

    async topVendors(args) {
      const all = await this.spendByVendor({ tenantId: args.tenantId });
      return all.slice(0, args.topN);
    },

    async vendorPerformance(args) {
      const vendors = await port.listVendors(args.tenantId);
      const pos = await port.listPos(args.tenantId);
      const invoices = await port.listInvoices(args.tenantId);
      const out: Array<VendorPerformance> = [];
      const vendorsByPo = new Map(pos.map((p) => [p.id, p]));
      for (const vendor of vendors) {
        const vendorPos = pos.filter((p) => p.vendorId === vendor.id);
        if (vendorPos.length === 0) continue;
        const receivedPos = vendorPos.filter(
          (p) => p.status === 'received' || p.status === 'closed',
        );
        const onTime = receivedPos.filter((p) => {
          // Best-effort: compare PO.deliveryDate to issuedAt + transit margin
          if (!p.issuedAt) return false;
          return new Date(p.deliveryDate) >= new Date(p.issuedAt);
        }).length;
        const onTimeDeliveryRate = receivedPos.length === 0 ? 0 : onTime / receivedPos.length;
        const vendorInvoices = invoices.filter((i) => i.vendorId === vendor.id);
        const exceptions = vendorInvoices.filter((i) => i.status === 'exception').length;
        const qualityScore =
          vendorInvoices.length === 0 ? 1 : 1 - exceptions / vendorInvoices.length;
        out.push({
          vendorId: vendor.id,
          vendorName: vendor.companyName,
          onTimeDeliveryRate: round2(onTimeDeliveryRate),
          qualityScore: round2(qualityScore),
          avgPriceVsMarket: 1, // placeholder until benchmark feed wired
          complaintsCount: 0,
          ratingDecile: vendor.rating === null ? 5 : Math.max(1, Math.min(10, Math.round(vendor.rating * 2))),
        });
      }
      // touch vendorsByPo to keep the map for future extensions
      void vendorsByPo;
      return out.sort((a, b) => b.qualityScore - a.qualityScore);
    },

    async detectMaverickSpend(args) {
      const pos = await port.listPos(args.tenantId);
      const frameworks = await port.listFrameworkAgreements(args.tenantId);
      const out: Array<MaverickSpendItem> = [];
      for (const po of poInFlight(pos)) {
        const usedFramework = po.frameworkAgreementId !== null;
        const hadRfq = po.rfqId !== null;
        const activeFramework = frameworks.find(
          (f) =>
            f.status === 'active' &&
            f.vendorId === po.vendorId &&
            po.items.some((i) => i.sku && f.lineRates.some((r) => r.sku === i.sku)),
        );
        if (!usedFramework && activeFramework) {
          out.push({
            poId: po.id,
            vendorId: po.vendorId,
            amount: po.total,
            currency: po.currency,
            reason: 'outside_framework',
            suggestedAction: `Re-issue against framework ${activeFramework.id}`,
          });
          continue;
        }
        if (
          !hadRfq &&
          po.total > (args.singleBidHighValueThreshold ?? 100_000)
        ) {
          out.push({
            poId: po.id,
            vendorId: po.vendorId,
            amount: po.total,
            currency: po.currency,
            reason: 'no_rfq',
            suggestedAction: 'High-value PO without competitive RFQ — review buyer policy',
          });
        }
      }
      return out;
    },

    async suggestFrameworkCandidates(args) {
      const pos = await port.listPos(args.tenantId);
      const vendors = await port.listVendors(args.tenantId);
      const frameworks = await port.listFrameworkAgreements(args.tenantId);
      const byVendor = new Map<VendorId, { amount: number; count: number; currency: CurrencyCode }>();
      for (const po of poInFlight(pos)) {
        const hasActive = frameworks.some(
          (f) => f.vendorId === po.vendorId && f.status === 'active',
        );
        if (hasActive) continue;
        const prev = byVendor.get(po.vendorId) ?? { amount: 0, count: 0, currency: po.currency };
        byVendor.set(po.vendorId, {
          amount: prev.amount + po.total,
          count: prev.count + 1,
          currency: prev.currency,
        });
      }
      return Array.from(byVendor.entries())
        .filter(([, v]) => v.count >= 3)
        .map(([vendorId, v]) => ({
          vendorId,
          vendorName: vendors.find((vv) => vv.id === vendorId)?.companyName ?? vendorId,
          poCount: v.count,
          amount: round2(v.amount),
          currency: v.currency,
        }))
        .sort((a, b) => b.amount - a.amount);
    },
  };
}

function poInFlight(pos: ReadonlyArray<PurchaseOrder>): ReadonlyArray<PurchaseOrder> {
  return pos.filter((p) => p.status !== 'cancelled');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { Vendor, FrameworkAgreement };
