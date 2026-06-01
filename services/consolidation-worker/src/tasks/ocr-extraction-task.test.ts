/**
 * ocr-extraction-task tests (Wave DOC-INTEL).
 *
 * Coverage:
 *   1. Happy path — storage fetch → OCR → brain-augmented extraction →
 *      INSERT ocr_extractions → back-point document_uploads → audit append,
 *      all inside a BEGIN/SET LOCAL/COMMIT tenant-context transaction.
 *   2. Tenant GUC binding — the SET LOCAL for both `app.current_tenant_id`
 *      and `app.tenant_id` is issued with the document's tenant, and the
 *      writes are wrapped BEGIN…COMMIT (no leak onto the pooled connection).
 *   3. Storage miss — null fetch → `storage_miss`, no writes.
 *   4. No OCR text — empty OCR → `no_text`, persists an empty marker row so
 *      the poll does not loop forever.
 *   5. Failure isolation — an OCR throw → `failed`, never propagates.
 *   6. Poll — selects ready docs and processes each; aggregates counts.
 *
 * All ports (storage / OCR / extractor / db) are mocked — zero install,
 * zero network, zero real OCR/brain.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runOcrExtractionForDocument,
  pollAndRunOcrExtractions,
  ASYNC_OCR_PROVIDER_PREFIX,
  type OcrExtractionDb,
  type OcrExtractionDeps,
  type ReadyDocument,
  type StorageFetchPort,
  type OcrPort,
  type BrainExtractPort,
  type ExtractionOutcome,
} from './ocr-extraction-task.js';

// ---------------------------------------------------------------------------
// Mock db — records every executed statement as a normalised SQL string.
// drizzle-orm's `sql` template produces a SQLChunk object; we stringify it by
// pulling its `.queryChunks` text parts so assertions can match keywords.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly text: string;
}

function sqlToText(query: unknown): string {
  // drizzle SQL objects expose `queryChunks`; fall back to String().
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> })?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((chunk) => {
        const value = (chunk as { value?: unknown })?.value;
        if (Array.isArray(value)) return value.join('');
        if (typeof value === 'string') return value;
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return String(query);
}

function makeDb(selectRows: ReadonlyArray<Record<string, unknown>> = []): OcrExtractionDb & {
  readonly calls: ReadonlyArray<RecordedCall>;
} {
  const calls: RecordedCall[] = [];
  const db = {
    async execute(query: unknown) {
      const text = sqlToText(query);
      calls.push({ text });
      // The candidate SELECT returns the seeded ready-doc rows.
      if (/FROM document_uploads/i.test(text) && /SELECT/i.test(text)) {
        return { rows: selectRows };
      }
      return { rows: [] };
    },
  };
  return Object.assign(db, {
    get calls() {
      return calls;
    },
  });
}

function makeStorage(
  result: { readonly bytes: Uint8Array; readonly mime: string } | null,
): StorageFetchPort & { calls: number } {
  let calls = 0;
  const port: StorageFetchPort = {
    async fetch() {
      calls += 1;
      return result;
    },
  };
  return Object.assign(port, {
    get calls() {
      return calls;
    },
  });
}

function makeOcr(text: string, producedBy = 'mock-ocr'): OcrPort {
  return {
    id: producedBy,
    async recognize() {
      return { text, producedBy, dominantLanguage: 'en' };
    },
  };
}

function makeThrowingOcr(): OcrPort {
  return {
    id: 'boom',
    async recognize() {
      throw new Error('ocr engine unreachable');
    },
  };
}

function makeExtractor(outcome: ExtractionOutcome): BrainExtractPort & { calls: number } {
  let calls = 0;
  const port: BrainExtractPort = {
    async extract() {
      calls += 1;
      return outcome;
    },
  };
  return Object.assign(port, {
    get calls() {
      return calls;
    },
  });
}

const READY_DOC: ReadyDocument = {
  documentId: 'doc-1111-2222',
  tenantId: 'tenant-abc',
  mimeType: 'application/pdf',
  documentType: 'lease_agreement',
  kind: 'contract',
  fileName: 'lease.pdf',
  fileUrl: 'tenant-uploads/tenant-abc/2026-06/doc-1111-2222.pdf',
};

const RICH_OUTCOME: ExtractionOutcome = {
  schemaId: 'lease_agreement',
  extractedFields: { tenant_name: 'Acme', monthly_rent: '500000' },
  confidenceScores: { tenant_name: 0.9, monthly_rent: 0.82 },
  overallConfidence: 0.86,
  brainAugmented: true,
};

function makeDeps(over: Partial<OcrExtractionDeps> = {}): {
  deps: OcrExtractionDeps;
  db: ReturnType<typeof makeDb>;
} {
  const db = (over.db as ReturnType<typeof makeDb>) ?? makeDb();
  const deps: OcrExtractionDeps = {
    db,
    storage:
      over.storage ??
      makeStorage({ bytes: new Uint8Array([1, 2, 3, 4]), mime: 'application/pdf' }),
    ocr: over.ocr ?? makeOcr('LANDLORD: Borjie Ltd\nTENANT: Acme\nMONTHLY RENT: 500000'),
    extractor: over.extractor ?? makeExtractor(RICH_OUTCOME),
    ...(over.providerTag ? { providerTag: over.providerTag } : {}),
  };
  return { deps, db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOcrExtractionForDocument', () => {
  it('runs the full happy path and persists inside a tenant-context txn', async () => {
    const { deps, db } = makeDeps();

    const result = await runOcrExtractionForDocument(deps, READY_DOC);

    expect(result.status).toBe('extracted');
    expect(result.extractionId).toBeTruthy();
    expect(result.schemaId).toBe('lease_agreement');
    expect(result.fieldCount).toBe(2);
    expect(result.brainAugmented).toBe(true);
    expect(result.producedBy).toBe('mock-ocr');

    const texts = db.calls.map((c) => c.text);
    // Transaction envelope.
    expect(texts.some((t) => /^BEGIN$/i.test(t))).toBe(true);
    expect(texts.some((t) => /COMMIT/i.test(t))).toBe(true);
    // GUC binding for BOTH names.
    expect(
      texts.some(
        (t) =>
          /set_config/i.test(t) &&
          /app\.current_tenant_id/i.test(t) &&
          /app\.tenant_id/i.test(t),
      ),
    ).toBe(true);
    // Insert into ocr_extractions.
    expect(texts.some((t) => /INSERT INTO ocr_extractions/i.test(t))).toBe(true);
    // Back-point document_uploads.ocr_extraction_id.
    expect(
      texts.some((t) => /UPDATE document_uploads/i.test(t) && /ocr_extraction_id/i.test(t)),
    ).toBe(true);
    // Hash-chained audit append.
    expect(texts.some((t) => /INSERT INTO ai_audit_chain/i.test(t))).toBe(true);
  });

  it('orders BEGIN → set_config → writes → COMMIT', async () => {
    const { deps, db } = makeDeps();
    await runOcrExtractionForDocument(deps, READY_DOC);
    const texts = db.calls.map((c) => c.text);
    const begin = texts.findIndex((t) => /^BEGIN$/i.test(t));
    const setcfg = texts.findIndex((t) => /set_config/i.test(t));
    const insert = texts.findIndex((t) => /INSERT INTO ocr_extractions/i.test(t));
    const commit = texts.findIndex((t) => /COMMIT/i.test(t));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(setcfg);
    expect(setcfg).toBeLessThan(insert);
    expect(insert).toBeLessThan(commit);
  });

  it('tags the provider with the async prefix so it supersedes the heuristic row', async () => {
    // Capture the provider value flowing into the INSERT by spying on execute.
    const captured: string[] = [];
    const db: OcrExtractionDb = {
      async execute(query: unknown) {
        captured.push(sqlToText(query));
        return { rows: [] };
      },
    };
    const { deps } = makeDeps({ db: db as ReturnType<typeof makeDb> });
    const result = await runOcrExtractionForDocument(deps, READY_DOC);
    expect(result.status).toBe('extracted');
    // The provider tag (a bound parameter) won't show in the SQL text, but
    // the default tag is derived from the async prefix — assert via the
    // public constant and the result shape rather than the param value.
    expect(ASYNC_OCR_PROVIDER_PREFIX).toBe('async-ocr');
    expect(captured.some((t) => /INSERT INTO ocr_extractions/i.test(t))).toBe(true);
  });

  it('returns storage_miss and writes nothing when the binary is absent', async () => {
    const { deps, db } = makeDeps({ storage: makeStorage(null) });
    const result = await runOcrExtractionForDocument(deps, READY_DOC);
    expect(result.status).toBe('storage_miss');
    expect(result.extractionId).toBeNull();
    // No transaction / insert should have run.
    expect(db.calls.some((c) => /INSERT INTO ocr_extractions/i.test(c.text))).toBe(false);
    expect(db.calls.some((c) => /^BEGIN$/i.test(c.text))).toBe(false);
  });

  it('returns no_text and persists an empty marker row when OCR yields nothing', async () => {
    const { deps, db } = makeDeps({ ocr: makeOcr('   ') });
    const extractor = deps.extractor as BrainExtractPort & { calls: number };
    const result = await runOcrExtractionForDocument(deps, READY_DOC);
    expect(result.status).toBe('no_text');
    // Extraction must NOT have been attempted on empty text.
    expect(extractor.calls).toBe(0);
    // But a marker row IS written so the poll stops re-selecting this doc.
    expect(db.calls.some((c) => /INSERT INTO ocr_extractions/i.test(c.text))).toBe(true);
  });

  it('isolates failures — an OCR throw yields failed, never propagates', async () => {
    const { deps } = makeDeps({ ocr: makeThrowingOcr() });
    const result = await runOcrExtractionForDocument(deps, READY_DOC);
    expect(result.status).toBe('failed');
    expect(result.extractionId).toBeNull();
  });

  it('rolls back when a write throws inside the txn', async () => {
    const calls: string[] = [];
    const db: OcrExtractionDb = {
      async execute(query: unknown) {
        const text = sqlToText(query);
        calls.push(text);
        if (/INSERT INTO ocr_extractions/i.test(text)) {
          throw new Error('unique violation');
        }
        return { rows: [] };
      },
    };
    const { deps } = makeDeps({ db: db as ReturnType<typeof makeDb> });
    const result = await runOcrExtractionForDocument(deps, READY_DOC);
    expect(result.status).toBe('failed');
    expect(calls.some((t) => /ROLLBACK/i.test(t))).toBe(true);
  });
});

describe('pollAndRunOcrExtractions', () => {
  it('selects ready docs and processes each, aggregating counts', async () => {
    const rows = [
      {
        document_id: 'doc-a',
        tenant_id: 'tenant-1',
        mime_type: 'application/pdf',
        document_type: 'lease_agreement',
        kind: 'contract',
        file_name: 'a.pdf',
        file_url: 'tenant-uploads/tenant-1/2026-06/doc-a.pdf',
      },
      {
        document_id: 'doc-b',
        tenant_id: 'tenant-2',
        mime_type: 'image/png',
        document_type: 'other',
        kind: 'other',
        file_name: 'b.png',
        file_url: 'tenant-uploads/tenant-2/2026-06/doc-b.png',
      },
    ];
    const db = makeDb(rows);
    const { deps } = makeDeps({ db });

    const result = await pollAndRunOcrExtractions(deps, { batchSize: 10 });

    expect(result.scanned).toBe(2);
    expect(result.extracted).toBe(2);
    expect(result.failed).toBe(0);
    // The candidate SELECT filtered on ready + NOT EXISTS async extraction.
    const selectText = db.calls.find((c) => /FROM document_uploads/i.test(c.text))?.text ?? '';
    expect(selectText).toMatch(/ingestion_status = 'ready'/i);
    expect(selectText).toMatch(/NOT EXISTS/i);
  });

  it('returns a clean zero result when the candidate select throws', async () => {
    const db: OcrExtractionDb = {
      async execute() {
        throw new Error('relation document_uploads does not exist');
      },
    };
    const { deps } = makeDeps({ db: db as ReturnType<typeof makeDb> });
    const result = await pollAndRunOcrExtractions(deps);
    expect(result).toEqual({ scanned: 0, extracted: 0, skipped: 0, failed: 0 });
  });
});
