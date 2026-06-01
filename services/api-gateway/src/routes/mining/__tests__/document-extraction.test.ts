/**
 * Tests for the upload → extract → persist wiring that activates the
 * (previously orphan) `extractFormFields` from `@borjie/document-ai`.
 *
 * Coverage:
 *   - Schema selection maps document types → the right pre-shipped schema,
 *     and falls through to generic for mining docs (licence / accountant
 *     export).
 *   - Schema-guided extraction over a text sample yields the expected
 *     structured fields + confidence maps (heuristic-only; no LLM).
 *   - Generic `Label: value` extraction handles a mining licence sample.
 *   - The `ocr_extractions` insert payload is shaped correctly (decimal
 *     confidence as string, raw text retained, provider tag).
 *   - End-to-end: a mounted `/upload` handler runs extraction and PERSISTS
 *     into a captured `ocr_extractions` mock, then `/extraction` retrieves
 *     it — exercising the real `runFormExtraction` + insert-builder path.
 *
 * No live Postgres: the db is a capturing in-memory mock. The heuristic
 * extractor is deterministic, so we assert real extracted values rather
 * than mocking it; the LLM (brain) path is intentionally NOT taken by the
 * synchronous wiring, so there is nothing to stub there.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  selectSchemaForDocument,
  runFormExtraction,
  extractGenericFields,
  buildOcrExtractionInsert,
} from '../document-extraction';

// ---------------------------------------------------------------------------
// Schema selection
// ---------------------------------------------------------------------------

describe('selectSchemaForDocument', () => {
  it('maps lease_agreement → lease schema', () => {
    expect(
      selectSchemaForDocument({ documentType: 'lease_agreement' })?.id,
    ).toBe('lease_agreement');
  });

  it('maps bank_statement → bank schema', () => {
    expect(
      selectSchemaForDocument({ documentType: 'bank_statement' })?.id,
    ).toBe('bank_statement');
  });

  it('maps national_id / passport → id_card schema', () => {
    expect(selectSchemaForDocument({ documentType: 'national_id' })?.id).toBe(
      'id_card',
    );
    expect(selectSchemaForDocument({ documentType: 'passport' })?.id).toBe(
      'id_card',
    );
  });

  it('maps invoice kind → invoice schema when type is generic', () => {
    expect(
      selectSchemaForDocument({ documentType: 'other', kind: 'invoice' })?.id,
    ).toBe('invoice');
  });

  it('returns null (→ generic) for a mining licence (notice type)', () => {
    expect(selectSchemaForDocument({ documentType: 'notice' })).toBeNull();
  });

  it('returns null (→ generic) for an unknown accountant export', () => {
    expect(selectSchemaForDocument({ documentType: 'other' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema-guided extraction (heuristic, no brain)
// ---------------------------------------------------------------------------

describe('runFormExtraction — schema-guided', () => {
  it('extracts lease fields from a text sample', async () => {
    const text = [
      'RESIDENTIAL LEASE AGREEMENT',
      'Landlord: Borjie Estates Ltd',
      'Tenant: John Mwangi',
      'Monthly rent: TZS 1,200,000',
      'Deposit: TZS 2,400,000',
    ].join('\n');

    const result = await runFormExtraction({
      documentId: 'doc-lease-1',
      text,
      sourceMime: 'text/plain',
      documentType: 'lease_agreement',
      kind: 'contract',
    });

    expect(result.schemaId).toBe('lease_agreement');
    expect(result.extractedFields.landlord_name).toBe('Borjie Estates Ltd');
    expect(result.extractedFields.tenant_name).toBe('John Mwangi');
    expect(result.extractedFields.monthly_rent).toContain('1,200,000');
    // Confidence map mirrors the extracted fields.
    expect(
      typeof result.confidenceScores.landlord_name,
    ).toBe('number');
    expect(result.overallConfidence).toBeGreaterThan(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('omits fields it cannot find (no junk in the jsonb map)', async () => {
    const result = await runFormExtraction({
      documentId: 'doc-lease-2',
      text: 'Landlord: Acme Holdings\n(nothing else here)',
      sourceMime: 'text/plain',
      documentType: 'lease_agreement',
    });
    expect(result.extractedFields.landlord_name).toBe('Acme Holdings');
    // tenant_name was not present → must be absent, not null/undefined.
    expect('tenant_name' in result.extractedFields).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generic extraction — mining licence / accountant export
// ---------------------------------------------------------------------------

describe('extractGenericFields — mining licence', () => {
  it('extracts Label: value pairs and snake_cases keys', () => {
    const fields = extractGenericFields(
      [
        'PRIMARY MINING LICENCE',
        'Licence Number: PML 0098/2026',
        'Holder Name: Kahama Gold Co',
        'Mineral: Gold',
        'Area (Ha): 12.5',
        'this line has no colon and is ignored',
      ].join('\n'),
    );
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
    expect(byName.licence_number).toBe('PML 0098/2026');
    expect(byName.holder_name).toBe('Kahama Gold Co');
    expect(byName.mineral).toBe('Gold');
    expect(byName.area_ha).toBe('12.5');
    // Lines without a colon are not fields.
    expect(fields.some((f) => f.value === 'this line has no colon and is ignored')).toBe(false);
  });

  it('runFormExtraction uses generic mode for a notice-type doc', async () => {
    const result = await runFormExtraction({
      documentId: 'doc-licence-1',
      text: 'Licence Number: PML 0098/2026\nMineral: Gold',
      sourceMime: 'text/plain',
      documentType: 'notice',
      kind: 'letter',
    });
    expect(result.schemaId).toBe('generic');
    expect(result.extractedFields.licence_number).toBe('PML 0098/2026');
    expect(result.extractedFields.mineral).toBe('Gold');
  });
});

// ---------------------------------------------------------------------------
// Persistence payload shape
// ---------------------------------------------------------------------------

describe('buildOcrExtractionInsert', () => {
  it('shapes the ocr_extractions row (decimal-as-string, raw text, provider tag)', async () => {
    const result = await runFormExtraction({
      documentId: 'doc-insert-1',
      text: 'Landlord: Borjie Estates Ltd',
      sourceMime: 'text/plain',
      documentType: 'lease_agreement',
    });
    const started = new Date('2026-06-01T10:00:00.000Z');
    const completed = new Date('2026-06-01T10:00:00.025Z');
    const insert = buildOcrExtractionInsert({
      tenantId: 'tenant-x',
      documentUploadId: 'doc-insert-1',
      result,
      rawText: 'Landlord: Borjie Estates Ltd',
      startedAt: started,
      completedAt: completed,
      extractionId: 'ext-fixed-1',
    });

    expect(insert.id).toBe('ext-fixed-1');
    expect(insert.tenantId).toBe('tenant-x');
    expect(insert.documentUploadId).toBe('doc-insert-1');
    expect(insert.ocrProvider).toBe('heuristic-text-sample:lease_agreement');
    expect(insert.validationStatus).toBe('extracted');
    expect(insert.rawText).toBe('Landlord: Borjie Estates Ltd');
    // Drizzle decimal columns round-trip as strings.
    expect(typeof insert.overallConfidence).toBe('string');
    expect(insert.overallConfidence).toMatch(/^\d\.\d{4}$/);
    expect(insert.processingDurationMs).toBe(25);
    expect(insert.extractedFields.landlord_name).toBe('Borjie Estates Ltd');
  });

  it('writes 0.0000 confidence when nothing was extracted', async () => {
    const result = await runFormExtraction({
      documentId: 'doc-empty',
      text: '(opaque scan — no key:value text)',
      sourceMime: 'text/plain',
      documentType: 'lease_agreement',
    });
    const insert = buildOcrExtractionInsert({
      tenantId: 't',
      documentUploadId: 'doc-empty',
      result,
      rawText: '(opaque scan — no key:value text)',
      startedAt: new Date(0),
      completedAt: new Date(0),
    });
    expect(insert.overallConfidence).toBe('0.0000');
    expect(Object.keys(insert.extractedFields)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: upload → extract → persist → retrieve (capturing mock db)
// ---------------------------------------------------------------------------

interface CapturedExtraction {
  readonly id: string;
  readonly tenantId: string;
  readonly documentUploadId: string;
  readonly extractedFields: Record<string, unknown>;
  readonly overallConfidence: string;
}

/**
 * A capturing mock db that mirrors exactly what the real `extractAndPersist`
 * helper does: insert into ocr_extractions, update document_uploads, append
 * audit. We assert the persisted row, then serve it back from the retrieval
 * handler — proving the round-trip without a live Postgres.
 */
function makeApp() {
  const extractions: CapturedExtraction[] = [];
  const updates: Array<Record<string, unknown>> = [];
  let audits = 0;

  const db = {
    insert: (_table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          extractions.push({
            id: String(v.id),
            tenantId: String(v.tenantId),
            documentUploadId: String(v.documentUploadId),
            extractedFields: (v.extractedFields as Record<string, unknown>) ?? {},
            overallConfidence: String(v.overallConfidence),
          });
          return [v];
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          updates.push(v);
          return [];
        },
      }),
    }),
    execute: async () => {
      audits += 1;
      return [];
    },
  };

  const app = new Hono();

  // Mirror of the production /upload extraction arm.
  app.post('/upload', async (c) => {
    const body = (await c.req.json()) as {
      documentId: string;
      textSample: string;
      documentType: string;
      kind: string;
    };
    const startedAt = new Date();
    const result = await runFormExtraction({
      documentId: body.documentId,
      text: body.textSample,
      sourceMime: 'text/plain',
      documentType: body.documentType,
      kind: body.kind,
    });
    const completedAt = new Date();
    const insert = buildOcrExtractionInsert({
      tenantId: 'tenant-e2e',
      documentUploadId: body.documentId,
      result,
      rawText: body.textSample,
      startedAt,
      completedAt,
      extractionId: `ext-${body.documentId}`,
    });
    await db.insert(null).values(insert).returning();
    await db.update(null).set({ ocrExtractionId: insert.id }).where(null);
    await db.execute();
    return c.json(
      {
        success: true,
        data: {
          documentId: body.documentId,
          extraction: {
            extractionId: insert.id,
            schemaId: result.schemaId,
            fieldCount: Object.keys(result.extractedFields).length,
          },
        },
      },
      201,
    );
  });

  app.get('/documents/:id/extraction', (c) => {
    const id = c.req.param('id');
    const row = extractions.find((e) => e.documentUploadId === id) ?? null;
    return c.json({ success: true, data: { documentId: id, extraction: row } }, 200);
  });

  return {
    app,
    state: { extractions, updates, get audits() { return audits; } },
  };
}

describe('upload → extract → persist → retrieve (round-trip)', () => {
  it('persists extracted lease fields and serves them back', async () => {
    const { app, state } = makeApp();

    const uploadRes = await app.request('/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId: 'd1',
        documentType: 'lease_agreement',
        kind: 'contract',
        textSample: 'Landlord: Borjie Estates Ltd\nTenant: John Mwangi',
      }),
    });
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as {
      data: { extraction: { extractionId: string; schemaId: string; fieldCount: number } };
    };
    expect(uploadBody.data.extraction.schemaId).toBe('lease_agreement');
    expect(uploadBody.data.extraction.fieldCount).toBeGreaterThanOrEqual(2);

    // Persistence happened: row captured, back-pointer set, audit appended.
    expect(state.extractions).toHaveLength(1);
    expect(state.extractions[0]!.documentUploadId).toBe('d1');
    expect(state.extractions[0]!.extractedFields.landlord_name).toBe(
      'Borjie Estates Ltd',
    );
    expect(state.updates[0]!.ocrExtractionId).toBe('ext-d1');
    expect(state.audits).toBe(1);

    // Retrieval serves the persisted structured fields back.
    const getRes = await app.request('/documents/d1/extraction');
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: { extraction: { extractedFields: Record<string, unknown> } | null };
    };
    expect(getBody.data.extraction?.extractedFields.tenant_name).toBe(
      'John Mwangi',
    );
  });

  it('persists generic fields for a mining licence document', async () => {
    const { app, state } = makeApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId: 'd2',
        documentType: 'notice',
        kind: 'letter',
        textSample: 'Licence Number: PML 0098/2026\nMineral: Gold',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { extraction: { schemaId: string } };
    };
    expect(body.data.extraction.schemaId).toBe('generic');
    expect(state.extractions[0]!.extractedFields.licence_number).toBe(
      'PML 0098/2026',
    );
  });
});
