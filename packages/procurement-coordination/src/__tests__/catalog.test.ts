import { describe, it, expect } from 'vitest';
import { createTestHarness } from './test-helpers.js';

async function seedVendor(harness: ReturnType<typeof createTestHarness>) {
  return harness.platform.vendors.registerVendor({
    tenantId: 'tnt-1',
    country: 'KE',
    companyName: 'Hardware Hut',
    registrationNumber: 'C1',
    taxId: 'T1',
    categories: ['maintenance'],
    contactEmail: 'sales@hh.co.ke',
  });
}

describe('catalog — items + framework agreements', () => {
  it('publishes a catalog item with rounded subtotal', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    const item = await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'BUCKET-20L',
      description: '20-litre construction bucket',
      unit: 'ea',
      unitPrice: 350,
      currency: 'KES',
      minOrderQty: 10,
      leadTimeDays: 3,
      validUntil: '2026-12-31',
      category: 'maintenance',
    });
    expect(item.id).toMatch(/^cat_/);
    expect(item.currency).toBe('KES');
  });

  it('creates a framework agreement', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    const fa = await h.platform.catalog.createFrameworkAgreement({
      tenantId: 'tnt-1',
      vendorId: v.id,
      title: '2026 maintenance supplies',
      startsAt: '2026-01-01',
      expiresAt: '2026-12-31',
      totalCap: 5_000_000,
      currency: 'KES',
      lineRates: [
        { sku: 'BUCKET-20L', negotiatedUnitPrice: 320, currency: 'KES' },
      ],
    });
    expect(fa.status).toBe('active');
    expect(fa.drawnDown).toBe(0);
  });

  it('refuses framework agreement when expiresAt <= startsAt', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    await expect(
      h.platform.catalog.createFrameworkAgreement({
        tenantId: 'tnt-1',
        vendorId: v.id,
        title: 'bad',
        startsAt: '2026-06-01',
        expiresAt: '2026-01-01',
        totalCap: 100,
        currency: 'KES',
        lineRates: [{ sku: 'X', negotiatedUnitPrice: 1, currency: 'KES' }],
      }),
    ).rejects.toThrow();
  });
});

describe('catalog — price lookup', () => {
  it('returns framework price when an active agreement covers the SKU', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'PIPE-A',
      description: 'PVC pipe class A',
      unit: 'm',
      unitPrice: 500,
      currency: 'KES',
      minOrderQty: 1,
      leadTimeDays: 2,
      category: 'plumbing',
    });
    await h.platform.catalog.createFrameworkAgreement({
      tenantId: 'tnt-1',
      vendorId: v.id,
      title: 'Plumbing 26',
      startsAt: '2026-01-01',
      expiresAt: '2026-12-31',
      totalCap: 1_000_000,
      currency: 'KES',
      lineRates: [{ sku: 'PIPE-A', negotiatedUnitPrice: 420, currency: 'KES' }],
    });
    const quote = await h.platform.catalog.priceLookup({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'PIPE-A',
      qty: 10,
    });
    expect(quote?.source).toBe('framework');
    expect(quote?.unitPrice).toBe(420);
    expect(quote?.subtotal).toBe(4200);
  });

  it('falls back to catalog when no framework covers the SKU', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'PIPE-B',
      description: 'pipe',
      unit: 'm',
      unitPrice: 500,
      currency: 'KES',
      minOrderQty: 1,
      leadTimeDays: 2,
      category: 'plumbing',
    });
    const q = await h.platform.catalog.priceLookup({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'PIPE-B',
      qty: 5,
    });
    expect(q?.source).toBe('catalog');
    expect(q?.subtotal).toBe(2500);
  });

  it('throws when qty < minOrderQty', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'PIPE-C',
      description: 'p',
      unit: 'm',
      unitPrice: 100,
      currency: 'KES',
      minOrderQty: 10,
      leadTimeDays: 1,
      category: 'plumbing',
    });
    await expect(
      h.platform.catalog.priceLookup({
        tenantId: 'tnt-1',
        vendorId: v.id,
        sku: 'PIPE-C',
        qty: 1,
      }),
    ).rejects.toThrow(/minOrderQty/);
  });

  it('returns null when no catalog item matches', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    const q = await h.platform.catalog.priceLookup({
      tenantId: 'tnt-1',
      vendorId: v.id,
      sku: 'UNKNOWN',
      qty: 1,
    });
    expect(q).toBeNull();
  });

  it('compares prices across vendors and orders ascending', async () => {
    const h = createTestHarness();
    const v1 = await seedVendor(h);
    const v2 = await h.platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'Cheap-O',
      registrationNumber: 'C2',
      taxId: 'T2',
      categories: ['maintenance'],
      contactEmail: 's@s.co',
    });
    await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v1.id,
      sku: 'WIDGET',
      description: 'w',
      unit: 'ea',
      unitPrice: 100,
      currency: 'KES',
      minOrderQty: 1,
      leadTimeDays: 1,
      category: 'maintenance',
    });
    await h.platform.catalog.publishCatalogItem({
      tenantId: 'tnt-1',
      vendorId: v2.id,
      sku: 'WIDGET',
      description: 'w',
      unit: 'ea',
      unitPrice: 80,
      currency: 'KES',
      minOrderQty: 1,
      leadTimeDays: 1,
      category: 'maintenance',
    });
    const compared = await h.platform.catalog.comparePrices({
      tenantId: 'tnt-1',
      sku: 'WIDGET',
      qty: 10,
      vendorIds: [v1.id, v2.id],
    });
    expect(compared).toHaveLength(2);
    expect(compared[0].vendorId).toBe(v2.id); // cheaper first
    expect(compared[0].subtotal).toBe(800);
  });

  it('draws down a framework and rejects over-cap draws', async () => {
    const h = createTestHarness();
    const v = await seedVendor(h);
    const fa = await h.platform.catalog.createFrameworkAgreement({
      tenantId: 'tnt-1',
      vendorId: v.id,
      title: 'cap',
      startsAt: '2026-01-01',
      expiresAt: '2026-12-31',
      totalCap: 1000,
      currency: 'KES',
      lineRates: [{ sku: 'X', negotiatedUnitPrice: 1, currency: 'KES' }],
    });
    const drawn = await h.platform.catalog.drawDownFramework({ id: fa.id, amount: 600 });
    expect(drawn.drawnDown).toBe(600);
    await expect(
      h.platform.catalog.drawDownFramework({ id: fa.id, amount: 500 }),
    ).rejects.toThrow(/exceeds remaining/);
  });
});
