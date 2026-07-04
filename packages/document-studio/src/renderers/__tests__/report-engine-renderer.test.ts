/**
 * REAL renderer proof — DEFECT B12 regression guard.
 *
 * Before the fix, the studio's document renderer emitted deterministic
 * `STUB:<id>:<format>:...` placeholder bytes. A customer generating a
 * PDF/DOCX/XLSX/PPTX got labelled stub text, not a real document.
 *
 * These tests assert the produced bytes are GENUINE documents by magic-byte
 * signature — a valid OOXML zip (`PK\x03\x04`) for docx/xlsx/pptx, and a
 * `%PDF` header for pdf — and that NO artifact carries the `STUB:` marker,
 * running the FULL studio pipeline (schema → bind → locale-purity gate →
 * render → citation gate → WORM seal), NOT the renderer in isolation.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createDocumentStudioWithCoreTypes,
  createDocTypeRegistry,
  registerCoreDocTypes,
  type DocTypeSpec,
} from '../../index.js';
import { ReportEngineRenderer } from '../report-engine-renderer.js';
import type { OfftakeSettlementData } from '../../templates/offtake-settlement/data-schema.js';
import { toOfftakeSettlementView } from '../../templates/offtake-settlement/builder.js';
import type { Citation } from '../../types.js';

// ── Magic bytes — PDF starts with `%PDF`, OOXML (docx/xlsx/pptx) with `PK\x03\x04`.
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

function startsWith(buf: Uint8Array, prefix: Uint8Array): boolean {
  if (buf.byteLength < prefix.byteLength) return false;
  for (let i = 0; i < prefix.byteLength; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

function decode(buf: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

function offtakeData(
  overrides?: Partial<OfftakeSettlementData>,
): OfftakeSettlementData {
  return {
    locale: 'en',
    currencyCode: 'TZS',
    buyer: { name: 'Acme Metals', reference: 'PO-9912' },
    producer: { name: 'Geita Co-op', licenceNo: 'PML-12345' },
    settlement: { settlementNo: 'STL-001', dateIssued: '2026-06-01' },
    lines: [
      {
        shipmentRef: 'SH-1',
        date: '2026-05-10',
        mineral: 'Gold',
        quantity: 12,
        unit: 'kg',
        provisionalUnitPrice: 150_000_000,
        finalUnitPrice: 152_000_000,
        advancePaid: 1_500_000_000,
      },
    ],
    citations: [],
    ...overrides,
  };
}

function citationsCovering(data: OfftakeSettlementData): Citation[] {
  const view = toOfftakeSettlementView(data);
  const figures = new Set<string>();
  for (const line of view.lines) {
    figures.add(line.provisionalValue);
    figures.add(line.finalValue);
    figures.add(line.advancePaid);
    figures.add(line.balanceDue);
  }
  figures.add(view.totals.totalProvisional);
  figures.add(view.totals.totalFinal);
  figures.add(view.totals.totalAdvance);
  figures.add(view.totals.totalBalance);
  return [...figures].map((claim, i) => ({
    id: `F${i}`,
    claim,
    source: { kind: 'computation' as const, ref: `assay:lab-${i}` },
  }));
}

describe('ReportEngineRenderer — real bytes per format (unit)', () => {
  const renderer = new ReportEngineRenderer();
  const view = toOfftakeSettlementView(offtakeData());

  it('docx → real OOXML zip (PK\\x03\\x04), not STUB', async () => {
    const out = await renderer.render({
      templateRef: 'offtake-settlement/template.docx',
      format: 'docx',
      data: view,
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, ZIP_MAGIC)).toBe(true);
    expect(decode(out.buffer).startsWith('STUB:')).toBe(false);
    expect(out.buffer.byteLength).toBeGreaterThan(500);
    expect(out.mimeType).toContain('wordprocessingml');
  });

  it('xlsx → real OOXML zip (PK\\x03\\x04), not STUB', async () => {
    const out = await renderer.render({
      templateRef: 'offtake-settlement/template.xlsx',
      format: 'xlsx',
      data: view,
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, ZIP_MAGIC)).toBe(true);
    expect(decode(out.buffer).startsWith('STUB:')).toBe(false);
    expect(out.mimeType).toContain('spreadsheetml');
  });

  it('pptx → real OOXML zip (PK\\x03\\x04), not STUB', async () => {
    const out = await renderer.render({
      templateRef: 'deck/template.pptx',
      format: 'pptx',
      data: view,
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, ZIP_MAGIC)).toBe(true);
    expect(decode(out.buffer).startsWith('STUB:')).toBe(false);
    expect(out.mimeType).toContain('presentationml');
  });

  it('pdf → real %PDF header, not STUB', async () => {
    const out = await renderer.render({
      templateRef: 'notice/template.typ',
      format: 'pdf',
      data: view,
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, PDF_MAGIC)).toBe(true);
    expect(decode(out.buffer).startsWith('STUB:')).toBe(false);
    expect(out.mimeType).toBe('application/pdf');
  });
});

describe('studio (useStub:false) — mining.document.generate emits real documents', () => {
  it('offtake_settlement xlsx+pdf are real bytes (not STUB), WORM-sealed', async () => {
    // This is the exact configuration the api-gateway composition root wires
    // for `mining.document.generate` (useStub: false → ReportEngineRenderer).
    const studio = createDocumentStudioWithCoreTypes({ useStub: false });
    const data = offtakeData();
    const out = await studio.generate({
      docType: 'offtake_settlement',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data,
      citations: citationsCovering(data),
      bucket: 'documents',
      formats: ['xlsx', 'pdf'],
      generatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(out.artifacts.map((a) => a.format).sort()).toEqual(['pdf', 'xlsx']);
    const byFormat = new Map(out.artifacts.map((a) => [a.format, a]));

    const xlsx = byFormat.get('xlsx')!;
    expect(startsWith(xlsx.bytes, ZIP_MAGIC)).toBe(true);
    expect(decode(xlsx.bytes).startsWith('STUB:')).toBe(false);

    const pdf = byFormat.get('pdf')!;
    expect(startsWith(pdf.bytes, PDF_MAGIC)).toBe(true);
    expect(decode(pdf.bytes).startsWith('STUB:')).toBe(false);

    // The FORCED WORM seal still ran on every real artifact.
    for (const a of out.artifacts) {
      expect(a.archived.auditChainHash).toBeTruthy();
      expect(a.sha256).toBe(a.archived.renderedSha256);
      expect(a.bytes.byteLength).toBeGreaterThan(0);
    }
  });

  it('an AUTHORED doc type renders real bytes across all 5 formats', async () => {
    // Proves the renderer serves the OPEN-ENDED registry (not just the core
    // types) with genuine bytes for every studio format.
    const registry = createDocTypeRegistry();
    registerCoreDocTypes(registry);
    const authored: DocTypeSpec = {
      id: 'safety_briefing',
      title: 'Site Safety Briefing',
      schema: z.object({ site: z.string() }).passthrough() as unknown as DocTypeSpec['schema'],
      binder: (raw) => ({
        templateRef: 'safety/briefing',
        view: {
          title: 'Site Safety Briefing',
          site: (raw as { site: string }).site,
          checklist: [
            { item: 'Hard hats worn', status: 'ok' },
            { item: 'Emergency exits clear', status: 'ok' },
          ],
          notes: 'All personnel briefed on evacuation route.',
        },
        locale: 'en',
        currencyCode: 'TZS',
      }),
      engineHint: 'carbone',
      // No monetary/date/legal claims in the view → inline citation gate passes.
      defaultFormats: ['docx', 'pdf', 'pptx', 'xlsx', 'html'],
    };
    registry.register(authored);
    const studio = createDocumentStudioWithCoreTypes({ registry, useStub: false });

    const out = await studio.generate({
      docType: 'safety_briefing',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data: { site: 'Kahama Block 4' },
      citations: [],
      bucket: 'documents',
      generatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const byFormat = new Map(out.artifacts.map((a) => [a.format, a.bytes]));
    // OOXML zips.
    for (const fmt of ['docx', 'pptx', 'xlsx'] as const) {
      const bytes = byFormat.get(fmt)!;
      expect(startsWith(bytes, ZIP_MAGIC), `${fmt} must be a real OOXML zip`).toBe(true);
      expect(decode(bytes).startsWith('STUB:')).toBe(false);
    }
    // PDF.
    expect(startsWith(byFormat.get('pdf')!, PDF_MAGIC)).toBe(true);
    // HTML is a real document (not STUB).
    const html = decode(byFormat.get('html')!);
    expect(html.startsWith('STUB:')).toBe(false);
    expect(html).toContain('<html>');
    expect(html).toContain('Site Safety Briefing');
  });

  it('stub mode still emits STUB bytes (opt-in only, for gate-only tests)', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const data = offtakeData();
    const out = await studio.generate({
      docType: 'offtake_settlement',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data,
      citations: citationsCovering(data),
      bucket: 'documents',
      formats: ['xlsx'],
    });
    // Explicit opt-in stub is unchanged — the default (real) path is the fix.
    expect(decode(out.artifacts[0]!.bytes).startsWith('STUB:')).toBe(true);
  });
});
