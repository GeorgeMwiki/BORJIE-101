/**
 * End-to-end pipeline tests — the keystone.
 *
 * Drives the full studio: registry → schema validate → data-binding →
 * locale-purity gate → renderer (stub) → citation gate → archive + WORM
 * seal → e-sign. Includes a NEW doc type (offtake_settlement) rendered
 * through the Carbone XLSX path, plus the multi-currency + EN/SW + the
 * citation-gap + locale-mixing rejection assertions.
 */

import { describe, expect, it } from 'vitest';
import {
  createDocumentStudioWithCoreTypes,
  createDocTypeRegistry,
  createRendererFactory,
  createDefaultRendererSet,
  createArtifactArchive,
  createInMemoryArchiveStorage,
  createInMemoryWormAuditStore,
  createDocumentStudio,
  createMockESignAdapter,
  registerCoreDocTypes,
  LocaleMixingError,
  CitationGapError,
  type DocTypeSpec,
} from '../../index.js';
import type { OfftakeSettlementData } from '../../templates/offtake-settlement/data-schema.js';
import { toOfftakeSettlementView } from '../../templates/offtake-settlement/builder.js';
import type { Citation } from '../../types.js';
import { z } from 'zod';

/**
 * Build citations whose claims COVER every money figure the worksheet
 * renders (the structured citation gate matches by claim-coverage). We
 * compute the bound view first, then cite each formatted figure — exactly
 * how an upstream evidence-binder would attach a `SpanCitation` per cell.
 */
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

/**
 * Build a full generate request for the offtake worksheet, attaching
 * request-level citations that COVER every rendered money figure (the
 * evidence-binding an upstream agent would supply per cell).
 */
function offtakeRequest(
  overrides?: Partial<OfftakeSettlementData>,
  extra?: { formats?: ReadonlyArray<'xlsx' | 'pdf'>; generatedAt?: Date },
) {
  const data = offtakeData(overrides);
  return {
    docType: 'offtake_settlement',
    tenantId: 'tenant-1',
    actorId: 'actor-1',
    data,
    citations: citationsCovering(data),
    bucket: 'documents',
    ...(extra?.formats ? { formats: extra.formats } : {}),
    ...(extra?.generatedAt ? { generatedAt: extra.generatedAt } : {}),
  };
}

describe('studio — new doc type end-to-end (offtake_settlement, Carbone XLSX)', () => {
  it('generates XLSX + PDF, archives both, seals the WORM chain', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const out = await studio.generate(
      offtakeRequest(undefined, {
        generatedAt: new Date('2026-06-08T00:00:00.000Z'),
      }),
    );

    expect(out.docType).toBe('offtake_settlement');
    expect(out.artifacts.map((a) => a.format).sort()).toEqual(['pdf', 'xlsx']);
    // Each artifact carries non-zero bytes + an immutable archive record.
    for (const a of out.artifacts) {
      expect(a.bytes.byteLength).toBeGreaterThan(0);
      expect(a.archived.auditChainHash).toBeTruthy();
      expect(a.sha256).toBe(a.archived.renderedSha256);
    }
  });

  it('binds every money figure via formatCurrency (multi-currency in output)', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const data = offtakeData({ currencyCode: 'KES' });
    const out = await studio.generate(
      offtakeRequest({ currencyCode: 'KES' }, { formats: ['xlsx'] }),
    );
    // The studio threads the tenant currency end-to-end onto the sealed
    // artifact + result; nothing hard-codes TZS.
    expect(out.currencyCode).toBe('KES');
    expect(out.artifacts[0]!.archived.currencyCode).toBe('KES');
    // The DOCUMENT MODEL (what the renderer consumes) carries every money
    // figure formatted in KES via formatCurrency — never a bare TZS.
    const view = toOfftakeSettlementView(data);
    expect(view.totals.totalFinal).toContain('KES');
    expect(view.lines[0]!.balanceDue).toContain('KES');
    expect(JSON.stringify(view)).not.toContain('TZS');
  });

  it('reproducible: same input + pinned generatedAt → identical sha256', async () => {
    const mk = () => createDocumentStudioWithCoreTypes({ useStub: true });
    const args = offtakeRequest(undefined, {
      formats: ['xlsx'],
      generatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });
    const a = await mk().generate(args);
    const b = await mk().generate(args);
    expect(a.artifacts[0]!.sha256).toBe(b.artifacts[0]!.sha256);
  });
});

describe('studio — EN/SW absolute toggle in rendered output', () => {
  it('renders a Swahili document single-language', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const swData = offtakeData({ locale: 'sw' });
    const out = await studio.generate(
      offtakeRequest({ locale: 'sw' }, { formats: ['xlsx'] }),
    );
    expect(out.locale).toBe('sw');
    expect(out.artifacts[0]!.archived.language).toBe('sw');
    // The DOCUMENT MODEL is single-language: Swahili labels present, the
    // English column header is absent (EN/SW absolute toggle). The studio
    // already passed the locale-purity gate to produce this artifact.
    const view = toOfftakeSettlementView(swData);
    const text = JSON.stringify(view);
    expect(text).toContain('Malizo');
    expect(text).not.toContain('Settlement no.');
  });

  it('rejects a document whose view mixes languages (LOCALE_MIXING)', async () => {
    // Register a deliberately-broken doc type that leaks Swahili into an
    // English document; the locale-purity gate must catch it.
    const registry = createDocTypeRegistry();
    registerCoreDocTypes(registry);
    const leaky: DocTypeSpec = {
      id: 'leaky_en',
      title: 'Leaky',
      schema: z.object({}).passthrough() as unknown as DocTypeSpec['schema'],
      binder: () => ({
        templateRef: 'x/template.typ',
        view: { title: 'Statement', note: 'Jumla ya mrabaha leaked' },
        locale: 'en',
        currencyCode: 'TZS',
      }),
      engineHint: 'typst',
      defaultFormats: ['pdf'],
    };
    registry.register(leaky);
    const renderers = createRendererFactory(
      createDefaultRendererSet({ useStub: true }),
    );
    const archive = createArtifactArchive({
      worm: createInMemoryWormAuditStore(),
      storage: createInMemoryArchiveStorage(),
    });
    const studio = createDocumentStudio({ registry, renderers, archive });
    await expect(
      studio.generate({
        docType: 'leaky_en',
        tenantId: 't',
        actorId: 'a',
        data: {},
        bucket: 'documents',
      }),
    ).rejects.toBeInstanceOf(LocaleMixingError);
  });
});

describe('studio — citation gate (evidence-required hard rail)', () => {
  it('rejects an uncited monetary claim in the rendered text', async () => {
    // A doc type that renders a bare monetary figure with NO citation tag.
    const registry = createDocTypeRegistry();
    const uncited: DocTypeSpec = {
      id: 'uncited',
      title: 'Uncited',
      schema: z.object({}).passthrough() as unknown as DocTypeSpec['schema'],
      binder: () => ({
        templateRef: 'x/template.typ',
        view: { body: 'Pay TZS 1,000,000 immediately' },
        locale: 'en',
        currencyCode: 'TZS',
      }),
      engineHint: 'typst',
      defaultFormats: ['pdf'],
    };
    registry.register(uncited);
    const renderers = createRendererFactory(
      createDefaultRendererSet({ useStub: true }),
    );
    const archive = createArtifactArchive({
      worm: createInMemoryWormAuditStore(),
      storage: createInMemoryArchiveStorage(),
    });
    const studio = createDocumentStudio({ registry, renderers, archive });
    await expect(
      studio.generate({
        docType: 'uncited',
        tenantId: 't',
        actorId: 'a',
        data: {},
        bucket: 'documents',
        citations: [],
      }),
    ).rejects.toBeInstanceOf(CitationGapError);
  });
});

describe('studio — e-sign flow', () => {
  it('sends an archived artifact for signature and links the signed copy', async () => {
    const studio = createDocumentStudioWithCoreTypes({
      useStub: true,
      esign: createMockESignAdapter(),
    });
    const gen = await studio.generate(
      offtakeRequest(undefined, { formats: ['pdf'] }),
    );
    const artifactId = gen.artifacts[0]!.archived.artifactId;
    const signed = await studio.sendForSignature({
      artifactId,
      title: 'Off-take Settlement',
      signers: [
        { role: 'buyer', name: 'Acme', email: 'buyer@example.com', order: 0 },
      ],
      tier: 'ses',
      bucket: 'documents',
    });
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.provider).toBe('mock');
    expect(signed.signature?.tier).toBe('ses');
  });

  it('throws when e-sign is requested but no port was injected', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    await expect(
      studio.sendForSignature({
        artifactId: 'x',
        title: 't',
        signers: [{ role: 'r', name: 'n', email: 'e@e.com', order: 0 }],
        bucket: 'documents',
      }),
    ).rejects.toThrow(/e-sign port not injected/);
  });
});

describe('studio — registry errors', () => {
  it('rejects an unknown doc type with the registered set listed', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    await expect(
      studio.generate({
        docType: 'does_not_exist',
        tenantId: 't',
        actorId: 'a',
        data: {},
        bucket: 'documents',
      }),
    ).rejects.toThrow(/unknown doc type/);
  });

  it('surfaces a renderer error as RenderError', async () => {
    const registry = createDocTypeRegistry();
    const spec: DocTypeSpec = {
      id: 'render_fail',
      title: 'RF',
      schema: z.object({}).passthrough() as unknown as DocTypeSpec['schema'],
      binder: () => ({
        templateRef: 'x',
        view: { title: 'Clean English Document' },
        locale: 'en',
        currencyCode: 'TZS',
      }),
      engineHint: 'typst',
      defaultFormats: ['pdf'],
    };
    registry.register(spec);
    // A renderer factory whose typst renderer always errors.
    const renderers = {
      getRenderer: () => ({
        id: 'failing',
        async render() {
          return {
            buffer: new Uint8Array(0),
            mimeType: 'application/json',
            error: {
              code: 'binary_failed' as const,
              message: 'boom',
              origin: 'typst',
            },
          };
        },
      }),
    };
    const archive = createArtifactArchive({
      worm: createInMemoryWormAuditStore(),
      storage: createInMemoryArchiveStorage(),
    });
    const studio = createDocumentStudio({ registry, renderers, archive });
    await expect(
      studio.generate({
        docType: 'render_fail',
        tenantId: 't',
        actorId: 'a',
        data: {},
        bucket: 'documents',
      }),
    ).rejects.toThrow(/RENDER_ERROR/);
  });

  it('returns the unsigned artifact when an envelope stays in-flight', async () => {
    // Mock e-sign that never completes within the poll budget.
    const stalledEsign = createMockESignAdapter({ completeAfterPolls: 99 });
    const studio = createDocumentStudioWithCoreTypes({
      useStub: true,
      esign: stalledEsign,
    });
    const gen = await studio.generate(
      offtakeRequest(undefined, { formats: ['pdf'] }),
    );
    const artifactId = gen.artifacts[0]!.archived.artifactId;
    const result = await studio.sendForSignature({
      artifactId,
      title: 'In-flight',
      signers: [{ role: 'r', name: 'n', email: 'e@e.com', order: 0 }],
      bucket: 'documents',
    });
    // Still unsigned (HITL re-polls + links later).
    expect(result.signature).toBeUndefined();
  });

  it('rejects sendForSignature for an unknown artifact', async () => {
    const studio = createDocumentStudioWithCoreTypes({
      useStub: true,
      esign: createMockESignAdapter(),
    });
    await expect(
      studio.sendForSignature({
        artifactId: 'nope',
        title: 't',
        signers: [{ role: 'r', name: 'n', email: 'e@e.com', order: 0 }],
        bucket: 'documents',
      }),
    ).rejects.toThrow(/unknown artifact/);
  });
});
