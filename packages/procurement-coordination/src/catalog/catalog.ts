/**
 * Catalog + framework-agreement service.
 *
 * - Catalog items are vendor-published SKUs that a buyer can pull a
 *   spot price from (subject to `validUntil`).
 * - Framework agreements are negotiated standing contracts with a
 *   total cap (`totalCap`) and per-SKU `lineRates`. They take
 *   precedence over catalog spot prices.
 *
 * `priceLookup` returns the most-advantageous price for a given
 * vendor + SKU + qty pair, marking the source so the procurement
 * audit trail can prove the price was contractually anchored.
 *
 * `comparePrices` runs price lookups for multiple vendors and orders
 * them ascending — the UI shows this as a side-by-side table.
 */

import { z } from 'zod';
import type {
  CatalogItem,
  ClockPort,
  CurrencyCode,
  FrameworkAgreement,
  FrameworkAgreementId,
  FrameworkAgreementLineRate,
  PriceQuote,
  ProcurementDataPort,
  VendorCategory,
  VendorId,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';

const CatalogItemSchema = z.object({
  tenantId: z.string().min(1),
  vendorId: z.string().min(1),
  sku: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(20),
  unitPrice: z.number().nonnegative(),
  currency: z.string().length(3),
  minOrderQty: z.number().positive(),
  leadTimeDays: z.number().int().nonnegative(),
  validUntil: z.string().nullable().optional(),
  category: z.string(),
});

const FrameworkSchema = z.object({
  tenantId: z.string().min(1),
  vendorId: z.string().min(1),
  title: z.string().min(1).max(200),
  startsAt: z.string(),
  expiresAt: z.string(),
  totalCap: z.number().positive(),
  currency: z.string().length(3),
  lineRates: z
    .array(
      z.object({
        sku: z.string(),
        negotiatedUnitPrice: z.number().nonnegative(),
        currency: z.string().length(3),
      }),
    )
    .min(1),
});

export interface CatalogService {
  publishCatalogItem(input: z.input<typeof CatalogItemSchema>): Promise<CatalogItem>;
  createFrameworkAgreement(input: z.input<typeof FrameworkSchema>): Promise<FrameworkAgreement>;
  priceLookup(args: {
    readonly tenantId: string;
    readonly vendorId: VendorId;
    readonly sku: string;
    readonly qty: number;
  }): Promise<PriceQuote | null>;
  comparePrices(args: {
    readonly tenantId: string;
    readonly sku: string;
    readonly qty: number;
    readonly vendorIds: ReadonlyArray<VendorId>;
  }): Promise<ReadonlyArray<PriceQuote>>;
  drawDownFramework(args: {
    readonly id: FrameworkAgreementId;
    readonly amount: number;
  }): Promise<FrameworkAgreement>;
}

export interface CatalogServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
}

export function createCatalogService(deps: CatalogServiceDeps): CatalogService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async publishCatalogItem(rawInput) {
      const input = CatalogItemSchema.parse(rawInput);
      const item: CatalogItem = {
        id: `cat_${idFactory()}`,
        tenantId: input.tenantId,
        vendorId: input.vendorId as VendorId,
        sku: input.sku,
        description: input.description,
        unit: input.unit,
        unitPrice: input.unitPrice,
        currency: input.currency.toUpperCase() as CurrencyCode,
        minOrderQty: input.minOrderQty,
        leadTimeDays: input.leadTimeDays,
        validUntil: input.validUntil ?? null,
        category: input.category as VendorCategory,
      };
      await port.insertCatalogItem(item);
      return item;
    },

    async createFrameworkAgreement(rawInput) {
      const input = FrameworkSchema.parse(rawInput);
      if (new Date(input.startsAt) >= new Date(input.expiresAt)) {
        throw new Error('Framework expiresAt must be after startsAt');
      }
      const agreement: FrameworkAgreement = {
        id: `fra_${idFactory()}`,
        tenantId: input.tenantId,
        vendorId: input.vendorId as VendorId,
        title: input.title,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        totalCap: input.totalCap,
        currency: input.currency.toUpperCase(),
        drawnDown: 0,
        lineRates: input.lineRates.map(
          (r): FrameworkAgreementLineRate => ({
            sku: r.sku,
            negotiatedUnitPrice: r.negotiatedUnitPrice,
            currency: r.currency.toUpperCase(),
          }),
        ),
        status: 'active',
      };
      await port.insertFrameworkAgreement(agreement);
      return agreement;
    },

    async priceLookup(args) {
      const frameworks = await port.listFrameworkAgreements(args.tenantId, args.vendorId);
      const now = clock.now();
      const activeFramework = frameworks.find(
        (f) =>
          f.status === 'active' &&
          new Date(f.startsAt) <= now &&
          new Date(f.expiresAt) >= now &&
          f.lineRates.some((r) => r.sku === args.sku),
      );
      if (activeFramework) {
        const rate = activeFramework.lineRates.find((r) => r.sku === args.sku);
        if (rate) {
          const subtotal = round2(rate.negotiatedUnitPrice * args.qty);
          return {
            source: 'framework',
            sourceId: activeFramework.id,
            vendorId: args.vendorId,
            sku: args.sku,
            unitPrice: rate.negotiatedUnitPrice,
            currency: rate.currency,
            qty: args.qty,
            subtotal,
          };
        }
      }
      const catalog = await port.listCatalogItems(args.tenantId, args.vendorId);
      const item = catalog.find(
        (c) => c.sku === args.sku && (c.validUntil === null || new Date(c.validUntil) >= now),
      );
      if (!item) return null;
      if (args.qty < item.minOrderQty) {
        throw new Error(
          `qty ${args.qty} below minOrderQty ${item.minOrderQty} for SKU ${args.sku}`,
        );
      }
      return {
        source: 'catalog',
        sourceId: item.id,
        vendorId: args.vendorId,
        sku: args.sku,
        unitPrice: item.unitPrice,
        currency: item.currency,
        qty: args.qty,
        subtotal: round2(item.unitPrice * args.qty),
      };
    },

    async comparePrices(args) {
      const quotes: Array<PriceQuote> = [];
      for (const vendorId of args.vendorIds) {
        try {
          const q = await this.priceLookup({
            tenantId: args.tenantId,
            vendorId,
            sku: args.sku,
            qty: args.qty,
          });
          if (q) quotes.push(q);
        } catch {
          // Skip vendors that fail (e.g. below minOrderQty) so the
          // comparison view shows the eligible ones only.
        }
      }
      return quotes.sort((a, b) => a.subtotal - b.subtotal);
    },

    async drawDownFramework(args) {
      const found = await port.findFrameworkAgreement(args.id);
      if (!found) {
        throw new Error(`Framework ${args.id} not found`);
      }
      if (found.status !== 'active') {
        throw new Error(`Framework ${args.id} is ${found.status}, cannot draw down`);
      }
      const newDrawn = found.drawnDown + args.amount;
      if (newDrawn > found.totalCap) {
        throw new Error(
          `Draw-down ${args.amount} exceeds remaining cap ${found.totalCap - found.drawnDown}`,
        );
      }
      const updated: FrameworkAgreement = {
        ...found,
        drawnDown: newDrawn,
      };
      await port.updateFrameworkAgreement(updated);
      return updated;
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
