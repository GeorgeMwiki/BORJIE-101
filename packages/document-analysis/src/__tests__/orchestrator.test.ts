import { describe, expect, it } from 'vitest';
import { ingestDocument } from '../ingest.js';
import {
  InMemoryDocumentRepository,
  InMemoryExtractionRepository,
  InMemoryEntityRepository,
  InMemoryRoutingRepository,
  InMemoryDocumentStorage,
  InMemoryEntityResolver,
  InMemoryEventBus,
} from '../in-memory-adapters.js';
import { analyzeDocument, renderCitation } from '../orchestrator.js';
import type { OrchestratorDeps } from '../orchestrator.js';
import { loadFixture, ALL_FIXTURES } from './fixtures.js';

function makePipeline(): OrchestratorDeps & {
  documents: InMemoryDocumentRepository;
  extractions: InMemoryExtractionRepository;
  entities: InMemoryEntityRepository;
  routing: InMemoryRoutingRepository;
  storage: InMemoryDocumentStorage;
  resolver: InMemoryEntityResolver;
  events: InMemoryEventBus;
} {
  return {
    documents: new InMemoryDocumentRepository(),
    extractions: new InMemoryExtractionRepository(),
    entities: new InMemoryEntityRepository(),
    routing: new InMemoryRoutingRepository(),
    storage: new InMemoryDocumentStorage(),
    resolver: new InMemoryEntityResolver(),
    events: new InMemoryEventBus(),
  };
}

async function ingestAndAnalyze(
  pipeline: ReturnType<typeof makePipeline>,
  tenantId: string,
  filename: string,
  content: string,
): Promise<Awaited<ReturnType<typeof analyzeDocument>>> {
  const { document } = await ingestDocument(
    {
      tenantId,
      filename,
      mimeType: 'text/plain',
      content,
    },
    pipeline,
  );
  return analyzeDocument(document.id, tenantId, pipeline);
}

describe('Orchestrator end-to-end — lease application', () => {
  it('classifies, extracts, resolves, and routes to ESTATE', async () => {
    const pipeline = makePipeline();
    pipeline.resolver.seed('tenant-a', [
      { entityId: 'lessee-001', displayName: 'Asha Mwangi' },
    ]);
    const text = loadFixture('lease-application');
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', 'lease.txt', text);

    expect(out.docType).toBe('lease_application');
    expect(out.docTypeConfidence).toBeGreaterThan(0.5);

    // Routing.
    expect(out.routings).toHaveLength(1);
    expect(out.routings[0]?.module).toBe('estate');
    expect(out.routings[0]?.action).toBe('create_lease_application');

    // Extractions persisted.
    const stored = pipeline.extractions.snapshot();
    expect(stored.some((s) => s.key === 'doc_type')).toBe(true);
    expect(stored.some((s) => s.key === 'applicant_name')).toBe(true);
    expect(stored.some((s) => s.key === 'requested_asset')).toBe(true);

    // Entity resolution: Asha Mwangi exact-matches.
    const resolved = pipeline.entities
      .snapshot()
      .find((e) => e.resolvedEntityId === 'lessee-001');
    expect(resolved).toBeDefined();
    expect(resolved?.resolutionMethod).toBe('exact_match');

    // Final state.
    expect(out.document.processingState).toBe('done');
  });
});

describe('Orchestrator end-to-end — payment receipt', () => {
  it('classifies, extracts, and routes to FINANCE', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('payment-receipt-gepg');
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', 'receipt.txt', text);
    expect(out.docType).toBe('payment_receipt');
    expect(out.routings[0]?.module).toBe('finance');
    expect(out.routings[0]?.action).toBe('post_receipt');

    const stored = pipeline.extractions.snapshot();
    expect(stored.some((s) => s.key === 'amount')).toBe(true);
    expect(stored.some((s) => s.key === 'gepg_reference')).toBe(true);
  });
});

describe('Orchestrator end-to-end — national ID', () => {
  it('classifies, extracts the NIDA number, routes to COMPLIANCE', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('national-id-nida');
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', 'nida.txt', text);
    expect(out.docType).toBe('national_id');
    expect(out.routings[0]?.module).toBe('compliance');
    expect(out.routings[0]?.action).toBe('archive_id');

    const idEx = pipeline.extractions
      .snapshot()
      .find((s) => s.key === 'id_number');
    expect(idEx?.value).toBe('19900215-44455-66677-02');
  });
});

describe('Orchestrator end-to-end — condition survey', () => {
  it('routes to ESTATE update_condition', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('condition-survey');
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', 'survey.txt', text);
    expect(out.docType).toBe('condition_survey');
    expect(out.routings[0]?.module).toBe('estate');
    expect(out.routings[0]?.action).toBe('update_condition');
  });
});

describe('Orchestrator end-to-end — complaint letter', () => {
  it('routes to CRM open_ticket', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('complaint-letter');
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', 'complaint.txt', text);
    expect(out.docType).toBe('complaint_letter');
    expect(out.routings[0]?.module).toBe('crm');
    expect(out.routings[0]?.action).toBe('open_ticket');
  });
});

describe('Orchestrator — events emitted at every stage', () => {
  it('emits ingested → ocr_done → parsed → extracted → resolved → routed → done', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('lease-application');
    await ingestAndAnalyze(pipeline, 'tenant-a', 'lease.txt', text);
    const stages = pipeline.events.events.map((e) => e.stage);
    expect(stages).toEqual([
      'ingested',
      'ocr_done',
      'parsed',
      'extracted',
      'resolved',
      'routed',
      'done',
    ]);
  });
});

describe('Orchestrator — all 5 fixtures produce a routing decision', () => {
  it.each(ALL_FIXTURES.map((f) => [f]))('processes %s end-to-end', async (name) => {
    const pipeline = makePipeline();
    const text = loadFixture(name);
    const out = await ingestAndAnalyze(pipeline, 'tenant-a', `${name}.txt`, text);
    expect(out.routings.length).toBeGreaterThan(0);
    expect(out.document.processingState).toBe('done');
  });
});

describe('Orchestrator — error path', () => {
  it('marks state=error when storage fetch fails', async () => {
    const pipeline = makePipeline();
    // Seed a row directly with a bogus storage path.
    const doc = await pipeline.documents.create({
      id: 'doc-bad',
      tenantId: 'tenant-a',
      uploadedByUserId: null,
      filename: 'x.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      storagePath: 'tenant/tenant-a/missing.txt',
      sha256: 'a'.repeat(64),
      sourceChannel: null,
      relatedThreadId: null,
    });
    await expect(
      analyzeDocument(doc.id, 'tenant-a', pipeline),
    ).rejects.toThrow();
    const after = await pipeline.documents.findById('tenant-a', doc.id);
    expect(after?.processingState).toBe('error');
  });

  it('throws DocumentNotFoundError for an unknown id', async () => {
    const pipeline = makePipeline();
    await expect(
      analyzeDocument('does-not-exist', 'tenant-a', pipeline),
    ).rejects.toMatchObject({ name: 'DocumentNotFoundError' });
  });
});

describe('Citation', () => {
  it('renderCitation returns page + bbox for an extraction', async () => {
    const pipeline = makePipeline();
    const text = loadFixture('lease-application');
    await ingestAndAnalyze(pipeline, 'tenant-a', 'lease.txt', text);
    const applicant = pipeline.extractions
      .snapshot()
      .find((s) => s.key === 'applicant_name');
    expect(applicant).toBeDefined();
    const cite = await renderCitation(
      'tenant-a',
      applicant!.id,
      pipeline.extractions,
    );
    expect(cite).not.toBeNull();
    expect(cite?.page).toBe(1);
    expect(cite?.bbox).not.toBeNull();
    expect(cite?.bbox?.w).toBeGreaterThan(0);
  });

  it('returns null when the extraction does not exist', async () => {
    const pipeline = makePipeline();
    const cite = await renderCitation(
      'tenant-a',
      'does-not-exist',
      pipeline.extractions,
    );
    expect(cite).toBeNull();
  });
});
