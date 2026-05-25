/**
 * Acceptance test for Document Agent v1.
 *
 * Drives the full junior pipeline with explicit port stubs so it does
 * not hit Anthropic, the database, or pdf-parse. The stubbed Claude
 * client returns a canned JSON payload that mirrors what a real Haiku
 * call would emit for the Tanzanian PML fixture in
 * `__tests__/fixtures/sample-pml-text.txt`.
 *
 * What this test guarantees:
 *   - The fixture text is read by the PdfReader port.
 *   - The Zod schema accepts the canned extraction.
 *   - The LicenceWriter port is called exactly once with the structured
 *     fields the AGENT_PROMPT_LIBRARY §1 contract promises.
 *   - The TemporalEntityWriter port is called exactly once with
 *     entity_type='licence', entity_key=licence_no, evidence_ids set,
 *     confidence + source populated (DATA_MODEL.md §2 columns).
 *   - The returned result surfaces both ids + the full evidence array.
 */

import { describe, it, expect, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDocumentAgent,
  type ClaudeClient,
  type LicenceRow,
  type LicenceWriter,
  type PdfReader,
  type TemporalEntityRow,
  type TemporalEntityWriter,
} from '../src/juniors/document-agent.js';

// ESM-safe __dirname replacement — the package is module: NodeNext.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample-pml-text.txt');

function stubClaude(jsonResponse: Record<string, unknown>): ClaudeClient {
  return {
    async complete() {
      return { content: JSON.stringify(jsonResponse) };
    },
  };
}

function recordingLicenceWriter() {
  const calls: LicenceRow[] = [];
  const writer: LicenceWriter = {
    async insert(row) {
      calls.push(row);
      return { id: row.id };
    },
  };
  return { writer, calls };
}

function recordingTemporalWriter() {
  const calls: TemporalEntityRow[] = [];
  const writer: TemporalEntityWriter = {
    async insert(row) {
      calls.push(row);
      return { id: row.id };
    },
  };
  return { writer, calls };
}

const fixturePdfReader: PdfReader = {
  async readText(path) {
    // The default reader handles .txt fixtures, but we use an explicit
    // stub here so the test is hermetic w.r.t. fs failures on CI.
    const { readFileSync } = await import('node:fs');
    return readFileSync(path, 'utf8');
  },
};

describe('Document Agent v1 — Borjie Phase 3 proof-of-life', () => {
  const cannedExtraction = {
    licence_no: 'PML-0034567/2024',
    holder: 'Mzee Komba Mining Co. Ltd',
    mineral: 'Au',
    coords_decimal_degrees: { lat: -6.7924, lng: 39.2083 },
    granted_at: '2024-03-15',
    expires_at: '2031-03-14',
    confidence: 0.92,
    rationale:
      'The licence number, holder, mineral, coordinates, and dates are all printed verbatim on the issued Primary Mining Licence form.',
    evidence_quotes: [
      'LICENCE NO.:           PML-0034567/2024',
      'Name of Holder:        Mzee Komba Mining Co. Ltd',
      'Mineral Authorised:    Gold (Au)',
      'Centroid Coordinates:  6.7924 S, 39.2083 E (decimal degrees: -6.7924, 39.2083)',
      'Date of Grant:         15 March 2024 (2024-03-15)',
      'Date of Expiry:        14 March 2031 (2031-03-14)',
    ],
  };

  it('extracts structured fields and writes licence + temporal entity', async () => {
    const licenceWriter = recordingLicenceWriter();
    const temporalWriter = recordingTemporalWriter();
    const agent = createDocumentAgent({
      pdfReader: fixturePdfReader,
      claude: stubClaude(cannedExtraction),
      licenceWriter: licenceWriter.writer,
      temporalEntityWriter: temporalWriter.writer,
    });

    const result = await agent.processPML({
      pdfPath: FIXTURE_PATH,
      tenantId: 'tenant_test',
      documentId: 'doc_pml_001',
    });

    expect(result.success).toBe(true);
    expect(result.licenceId).toBeTruthy();
    expect(result.entityId).toBeTruthy();
    expect(result.evidenceIds).toEqual(['doc_pml_001']);
    expect(result.extraction?.licence_no).toBe('PML-0034567/2024');
    expect(result.extraction?.holder).toBe('Mzee Komba Mining Co. Ltd');
    expect(result.extraction?.mineral).toBe('Au');
    expect(result.extraction?.coords_decimal_degrees).toEqual({
      lat: -6.7924,
      lng: 39.2083,
    });

    // Licence row contract
    expect(licenceWriter.calls).toHaveLength(1);
    const licenceRow = licenceWriter.calls[0];
    expect(licenceRow.type).toBe('PML');
    expect(licenceRow.number).toBe('PML-0034567/2024');
    expect(licenceRow.mineral).toBe('Au');
    expect(licenceRow.grantDate).toBe('2024-03-15');
    expect(licenceRow.expiryDate).toBe('2031-03-14');
    expect(licenceRow.status).toBe('active'); // 0.92 >= 0.70 floor
    expect(licenceRow.tenantId).toBe('tenant_test');
    expect(licenceRow.attributes).toMatchObject({
      coords_decimal_degrees: { lat: -6.7924, lng: 39.2083 },
      confidence: 0.92,
      extracted_by: 'document-agent.v1',
    });

    // Temporal-entity row contract (DATA_MODEL.md §2)
    expect(temporalWriter.calls).toHaveLength(1);
    const entityRow = temporalWriter.calls[0];
    expect(entityRow.entityType).toBe('licence');
    expect(entityRow.entityKey).toBe('PML-0034567/2024');
    expect(entityRow.tenantId).toBe('tenant_test');
    expect(entityRow.validFrom).toBe('2024-03-15');
    expect(entityRow.validTo).toBe('2031-03-14');
    expect(entityRow.confidence).toBeCloseTo(0.92, 5);
    expect(entityRow.evidenceIds).toEqual(['doc_pml_001']);
    expect(entityRow.source).toContain('agent:document-agent.v1');
    expect(entityRow.source).toContain('doc:doc_pml_001');
    expect(entityRow.attributes).toMatchObject({
      licence_id: licenceRow.id,
      licence_no: 'PML-0034567/2024',
      holder: 'Mzee Komba Mining Co. Ltd',
      mineral: 'Au',
      granted_at: '2024-03-15',
      expires_at: '2031-03-14',
    });
    expect(
      Array.isArray((entityRow.attributes as { evidence_quotes?: unknown }).evidence_quotes),
    ).toBe(true);
  });

  it('marks licence pending when extraction confidence is below 0.70 floor', async () => {
    const low = { ...cannedExtraction, confidence: 0.42 };
    const licenceWriter = recordingLicenceWriter();
    const temporalWriter = recordingTemporalWriter();
    const agent = createDocumentAgent({
      pdfReader: fixturePdfReader,
      claude: stubClaude(low),
      licenceWriter: licenceWriter.writer,
      temporalEntityWriter: temporalWriter.writer,
    });

    const result = await agent.processPML({
      pdfPath: FIXTURE_PATH,
      tenantId: 'tenant_test',
      documentId: 'doc_pml_low',
    });

    expect(result.success).toBe(true);
    expect(licenceWriter.calls[0]?.status).toBe('pending');
    expect(temporalWriter.calls[0]?.confidence).toBeCloseTo(0.42, 5);
  });

  it('returns a validation failure when Claude emits malformed JSON', async () => {
    const broken: ClaudeClient = {
      async complete() {
        return { content: 'not json at all' };
      },
    };
    const licenceWriter = recordingLicenceWriter();
    const temporalWriter = recordingTemporalWriter();
    const agent = createDocumentAgent({
      pdfReader: fixturePdfReader,
      claude: broken,
      licenceWriter: licenceWriter.writer,
      temporalEntityWriter: temporalWriter.writer,
    });

    const result = await agent.processPML({
      pdfPath: FIXTURE_PATH,
      tenantId: 'tenant_test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/parse_failed/);
    expect(licenceWriter.calls).toHaveLength(0);
    expect(temporalWriter.calls).toHaveLength(0);
  });

  it('returns a validation failure when extracted dates fail the schema', async () => {
    const badDates = { ...cannedExtraction, granted_at: '15-03-2024' };
    const licenceWriter = recordingLicenceWriter();
    const temporalWriter = recordingTemporalWriter();
    const agent = createDocumentAgent({
      pdfReader: fixturePdfReader,
      claude: stubClaude(badDates),
      licenceWriter: licenceWriter.writer,
      temporalEntityWriter: temporalWriter.writer,
    });

    const result = await agent.processPML({
      pdfPath: FIXTURE_PATH,
      tenantId: 'tenant_test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/validation_failed/);
    expect(licenceWriter.calls).toHaveLength(0);
    expect(temporalWriter.calls).toHaveLength(0);
  });

  it('calls Claude with the universal prompt envelope', async () => {
    const claude: ClaudeClient = {
      complete: vi.fn(async () => ({ content: JSON.stringify(cannedExtraction) })),
    };
    const licenceWriter = recordingLicenceWriter();
    const temporalWriter = recordingTemporalWriter();
    const agent = createDocumentAgent({
      pdfReader: fixturePdfReader,
      claude,
      licenceWriter: licenceWriter.writer,
      temporalEntityWriter: temporalWriter.writer,
    });

    await agent.processPML({
      pdfPath: FIXTURE_PATH,
      tenantId: 'tenant_test',
    });

    expect(claude.complete).toHaveBeenCalledOnce();
    const args = (claude.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      systemPrompt: string;
      userPrompt: string;
      model?: string;
    };
    expect(args.systemPrompt).toMatch(/Borjie Document Agent/);
    expect(args.systemPrompt).toMatch(/HARD RULES/);
    expect(args.systemPrompt).toMatch(/CONFIDENCE FLOOR/);
    expect(args.systemPrompt).toMatch(/OUTPUT SCHEMA/);
    expect(args.userPrompt).toMatch(/PML-0034567\/2024/);
    expect(args.model).toMatch(/haiku/);
  });
});
