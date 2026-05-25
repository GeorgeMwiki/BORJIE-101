/**
 * Barcode / QR support.
 *
 * Encoding is left to consumers — `@zxing/library` on the client, a
 * server-side renderer (qrcode) when generating PDF labels via
 * document-studio.
 *
 * This module gives us:
 *
 *   - `qrCodeForSku(sku)` — deterministic QR payload string for a SKU.
 *   - `qrCodeForAsset(serial)` — payload for a serialised asset.
 *   - `lookupByCode(code, { skus, serials })` — resolve a scanned
 *     payload back to a SKU or asset, regardless of which family.
 *   - `bulkLabelHtml(rows)` — minimal print-ready HTML for a label
 *     sheet, used by the scan/print page when document-studio is not
 *     plugged in.
 */

import type { AssetSerial, Sku, TenantId } from '../types.js';

export const QR_PROTOCOL = 'bnyum://inv/';

/** Build a deterministic QR payload for a SKU. */
export function qrCodeForSku(sku: Sku): string {
  return `${QR_PROTOCOL}sku/${sku.tenantId}/${encodeURIComponent(sku.code)}`;
}

/** Build a deterministic QR payload for an asset serial. */
export function qrCodeForAsset(asset: AssetSerial): string {
  return `${QR_PROTOCOL}asset/${asset.tenantId}/${asset.skuId}/${encodeURIComponent(asset.serialNumber)}`;
}

export type LookupResult =
  | { readonly kind: 'sku'; readonly sku: Sku }
  | { readonly kind: 'asset'; readonly asset: AssetSerial }
  | { readonly kind: 'unknown'; readonly code: string };

/**
 * Resolve a scanned code. Tries:
 *  1. parse as `bnyum://inv/...` payload,
 *  2. exact match against `Sku.barcode`,
 *  3. exact match against `Sku.qrCode`,
 *  4. exact match against `Sku.code`,
 *  5. exact match against `AssetSerial.serialNumber`.
 * Returns `kind: 'unknown'` when nothing matches.
 */
export function lookupByCode(
  code: string,
  ctx: { readonly skus: ReadonlyArray<Sku>; readonly serials: ReadonlyArray<AssetSerial>; readonly tenantId: TenantId },
): LookupResult {
  const trimmed = code.trim();
  if (!trimmed) return { kind: 'unknown', code };
  if (trimmed.startsWith(QR_PROTOCOL)) {
    const rest = trimmed.slice(QR_PROTOCOL.length);
    const parts = rest.split('/');
    if (parts[0] === 'sku' && parts[1] === ctx.tenantId && parts[2]) {
      const skuCode = decodeURIComponent(parts[2]);
      const sku = ctx.skus.find((s) => s.tenantId === ctx.tenantId && s.code === skuCode);
      if (sku) return { kind: 'sku', sku };
    }
    if (parts[0] === 'asset' && parts[1] === ctx.tenantId && parts[2] && parts[3]) {
      const serialNumber = decodeURIComponent(parts[3]);
      const asset = ctx.serials.find(
        (a) => a.tenantId === ctx.tenantId && a.skuId === parts[2] && a.serialNumber === serialNumber,
      );
      if (asset) return { kind: 'asset', asset };
    }
  }
  const skuBarcode = ctx.skus.find((s) => s.tenantId === ctx.tenantId && s.barcode === trimmed);
  if (skuBarcode) return { kind: 'sku', sku: skuBarcode };
  const skuQr = ctx.skus.find((s) => s.tenantId === ctx.tenantId && s.qrCode === trimmed);
  if (skuQr) return { kind: 'sku', sku: skuQr };
  const skuCode = ctx.skus.find((s) => s.tenantId === ctx.tenantId && s.code === trimmed);
  if (skuCode) return { kind: 'sku', sku: skuCode };
  const serial = ctx.serials.find((a) => a.tenantId === ctx.tenantId && a.serialNumber === trimmed);
  if (serial) return { kind: 'asset', asset: serial };
  return { kind: 'unknown', code: trimmed };
}

export interface LabelRow {
  readonly title: string;
  readonly subtitle?: string;
  readonly qrPayload: string;
}

/**
 * Minimal print-sheet HTML for bulk label printing. Returns a string
 * the caller can pipe straight to the browser (`window.print()`) or
 * to document-studio for PDF rendering. Each label is a 2"x1" cell.
 */
export function bulkLabelHtml(rows: ReadonlyArray<LabelRow>): string {
  const cells = rows
    .map(
      (r) => `
    <div class="label">
      <div class="qr-payload" aria-label="QR payload">${escapeHtml(r.qrPayload)}</div>
      <div class="title">${escapeHtml(r.title)}</div>
      ${r.subtitle ? `<div class="sub">${escapeHtml(r.subtitle)}</div>` : ''}
    </div>`,
    )
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Inventory labels</title>
<style>
  body { margin: 0; font-family: -apple-system, sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; padding: 6mm; }
  .label { border: 1px solid #aaa; padding: 6mm; font-size: 11pt; min-height: 24mm; }
  .qr-payload { font-family: monospace; font-size: 8pt; color: #555; word-break: break-all; margin-bottom: 2mm; }
  .title { font-weight: 600; }
  .sub { color: #444; font-size: 9pt; margin-top: 2mm; }
  @media print { .label { page-break-inside: avoid; } }
</style></head>
<body><div class="sheet">${cells}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
