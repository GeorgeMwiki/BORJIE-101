/**
 * Barcode lookup tests.
 */

import { describe, it, expect } from 'vitest';
import {
  bulkLabelHtml,
  lookupByCode,
  qrCodeForAsset,
  qrCodeForSku,
} from '../barcode/barcode.js';
import type { AssetSerial, Sku } from '../types.js';

const tenantId = 't-1';
const sku: Sku = {
  id: 'sku-bulb',
  tenantId,
  code: 'BULB-LED-9W',
  name: 'LED bulb',
  categoryId: null,
  unit: 'each',
  defaultUnitCostCents: 100,
  minimumStockLevel: 5,
  reorderQty: 50,
  leadTimeDays: 7,
  isAsset: false,
  barcode: '5012345678900',
};
const asset: AssetSerial = {
  id: 'as-1',
  tenantId,
  skuId: 'sku-fridge',
  serialNumber: 'SN-001',
  status: 'in_stock',
  currentLocationId: 'loc-a',
  installedInUnitId: null,
};

describe('lookupByCode', () => {
  it('resolves a QR payload back to a SKU', () => {
    const code = qrCodeForSku(sku);
    const r = lookupByCode(code, { skus: [sku], serials: [], tenantId });
    expect(r.kind).toBe('sku');
    if (r.kind !== 'sku') return;
    expect(r.sku.code).toBe('BULB-LED-9W');
  });

  it('resolves a QR payload back to an asset serial', () => {
    const code = qrCodeForAsset(asset);
    const r = lookupByCode(code, { skus: [], serials: [asset], tenantId });
    expect(r.kind).toBe('asset');
    if (r.kind !== 'asset') return;
    expect(r.asset.serialNumber).toBe('SN-001');
  });

  it('falls back to SKU.barcode for a raw EAN scan', () => {
    const r = lookupByCode('5012345678900', { skus: [sku], serials: [], tenantId });
    expect(r.kind).toBe('sku');
  });

  it('returns unknown for a string with no match', () => {
    const r = lookupByCode('not-in-system', { skus: [sku], serials: [asset], tenantId });
    expect(r.kind).toBe('unknown');
  });

  it('does not return SKUs from another tenant', () => {
    const code = qrCodeForSku(sku);
    const r = lookupByCode(code, { skus: [sku], serials: [], tenantId: 'attacker' });
    expect(r.kind).toBe('unknown');
  });

  it('does not return assets from another tenant', () => {
    const code = qrCodeForAsset(asset);
    const r = lookupByCode(code, { skus: [], serials: [asset], tenantId: 'attacker' });
    expect(r.kind).toBe('unknown');
  });

  it('resolves a SKU.code direct string match', () => {
    const r = lookupByCode('BULB-LED-9W', { skus: [sku], serials: [], tenantId });
    expect(r.kind).toBe('sku');
  });

  it('handles empty input gracefully', () => {
    const r = lookupByCode('   ', { skus: [sku], serials: [], tenantId });
    expect(r.kind).toBe('unknown');
  });
});

describe('bulkLabelHtml', () => {
  it('emits print-ready HTML with each row', () => {
    const html = bulkLabelHtml([
      { title: 'LED bulb 9W', subtitle: 'BULB-LED-9W', qrPayload: 'bnyum://inv/sku/t/BULB-LED-9W' },
      { title: 'Fridge SN-001', qrPayload: 'bnyum://inv/asset/t/sku-fridge/SN-001' },
    ]);
    expect(html).toContain('<html>');
    expect(html).toContain('LED bulb 9W');
    expect(html).toContain('Fridge SN-001');
    expect(html).toContain('BULB-LED-9W');
  });

  it('escapes HTML special chars in titles', () => {
    const html = bulkLabelHtml([{ title: '<script>alert(1)</script>', qrPayload: 'x' }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
