/**
 * Document Agent v1 — Borjie Phase 3, item 4.
 *
 * Smallest end-to-end mining junior: ingests a Tanzanian Primary Mining
 * Licence (PML) document, calls Claude Haiku to extract the structured
 * fields, validates the output with Zod, and writes one row to
 * `licences` plus one bi-temporal row to `temporal_entities`.
 *
 * The prompt follows the universal envelope defined in
 * `Docs/build/AGENT_PROMPT_LIBRARY.md` §0 — cite evidence, declare
 * confidence, output schema, hard rules.
 *
 * Architecture: every external dep is a port (`PdfReader`,
 * `ClaudeClient`, `LicenceWriter`, `TemporalEntityWriter`). Concrete
 * adapters live in `./document-agent-adapters.ts`. Business logic here
 * compiles + tests with pure stubs.
 *
 * Confidence floor (AGENT_PROMPT_LIBRARY §1): 0.70 for binding writes.
 * Below floor, we still write the `temporal_entities` row for audit but
 * mark the licence row's status as `pending` so a downstream junior
 * must verify.
 *
 * Schema gap (#30): the `licences` table is defined in DATA_MODEL.md
 * §3.1 but the Drizzle schema does NOT yet exist; the existing
 * `temporalEntities` schema is missing `confidence`, `evidence_ids`,
 * `source` columns. The adapters issue raw SQL so this junior compiles
 * today; swap for typed Drizzle once the schemas land.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  createDefaultPdfReader,
  lazyClaudeClient,
  lazyLicenceWriter,
  lazyTemporalEntityWriter,
} from './document-agent-adapters.js';
import {
  DOCUMENT_AGENT_SYSTEM_PROMPT,
  buildDocumentAgentUserPrompt,
} from './document-agent-prompt.js';
import {
  deterministicEvidenceId,
  deterministicLicenceId,
  failure,
  parseClaudeJson,
} from './document-agent-helpers.js';

// ─────────────────────────────────────────────────────────────────────
// Output schemas
// ─────────────────────────────────────────────────────────────────────

export const CoordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coords = z.infer<typeof CoordsSchema>;

export const PMLExtractionSchema = z.object({
  licence_no: z.string().min(1),
  holder: z.string().min(1),
  mineral: z.string().min(1),
  coords_decimal_degrees: CoordsSchema,
  granted_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'granted_at must be ISO date YYYY-MM-DD'),
  expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be ISO date YYYY-MM-DD'),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence_quotes: z.array(z.string()).min(1),
});
export type PMLExtraction = z.infer<typeof PMLExtractionSchema>;

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

export interface PdfReader {
  readText(pdfPath: string): Promise<string>;
}

export interface ClaudeClient {
  /**
   * Single-shot Claude completion. Returns the raw text content of the
   * first assistant message. Implementations should default to Haiku
   * per AGENT_PROMPT_LIBRARY §0 ("Haiku for cheap loops").
   */
  complete(args: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly model?: string;
  }): Promise<{ readonly content: string }>;
}

export interface LicenceWriter {
  insert(row: LicenceRow): Promise<{ readonly id: string }>;
}

export interface TemporalEntityWriter {
  insert(row: TemporalEntityRow): Promise<{ readonly id: string }>;
}

export interface LicenceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly type: 'PML';
  readonly number: string;
  readonly mineral: string;
  readonly holderName: string;
  readonly grantDate: string;
  readonly expiryDate: string;
  readonly status: 'active' | 'pending';
  readonly attributes: Record<string, unknown>;
}

export interface TemporalEntityRow {
  readonly id: string;
  readonly tenantId: string;
  readonly entityType: 'licence';
  readonly entityKey: string;
  readonly attributes: Record<string, unknown>;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly confidence: number;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly source: string;
}

export interface DocumentAgentDeps {
  readonly pdfReader: PdfReader;
  readonly claude: ClaudeClient;
  readonly licenceWriter: LicenceWriter;
  readonly temporalEntityWriter: TemporalEntityWriter;
  readonly logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface ProcessPMLInput {
  readonly pdfPath: string;
  readonly tenantId: string;
  readonly documentId?: string;
}

export interface ProcessPMLResult {
  readonly success: boolean;
  readonly licenceId?: string;
  readonly entityId?: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly extraction?: PMLExtraction;
  readonly error?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Junior — `documentAgent.processPML(...)`
// ─────────────────────────────────────────────────────────────────────

export function createDocumentAgent(deps: DocumentAgentDeps) {
  return {
    async processPML(input: ProcessPMLInput): Promise<ProcessPMLResult> {
      const evidenceIds = [input.documentId ?? deterministicEvidenceId(input.pdfPath)];

      let documentText: string;
      try {
        documentText = await deps.pdfReader.readText(input.pdfPath);
      } catch (error) {
        return failure(error, evidenceIds, 'pdf_read_failed');
      }

      let raw: string;
      try {
        const response = await deps.claude.complete({
          systemPrompt: DOCUMENT_AGENT_SYSTEM_PROMPT,
          userPrompt: buildDocumentAgentUserPrompt(documentText),
          maxTokens: 1024,
          temperature: 0,
          model: 'claude-haiku-4-5-20251001',
        });
        raw = response.content;
      } catch (error) {
        return failure(error, evidenceIds, 'claude_call_failed');
      }

      const parsed = parseClaudeJson(raw);
      if (!parsed.ok) {
        deps.logger?.warn('document-agent: malformed claude json', { raw: raw.slice(0, 256) });
        const parseErr = (parsed as { ok: false; error: string }).error;
        return { success: false, evidenceIds, error: `parse_failed: ${parseErr}` };
      }

      const validation = PMLExtractionSchema.safeParse(parsed.value);
      if (!validation.success) {
        deps.logger?.warn('document-agent: zod validation failed', { issues: validation.error.issues });
        return {
          success: false,
          evidenceIds,
          error: `validation_failed: ${validation.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      const extraction = validation.data;

      const status: 'active' | 'pending' = extraction.confidence >= 0.7 ? 'active' : 'pending';
      const licenceId = deterministicLicenceId(input.tenantId, extraction.licence_no);

      try {
        const licenceWrite = await deps.licenceWriter.insert({
          id: licenceId,
          tenantId: input.tenantId,
          type: 'PML',
          number: extraction.licence_no,
          mineral: extraction.mineral,
          holderName: extraction.holder,
          grantDate: extraction.granted_at,
          expiryDate: extraction.expires_at,
          status,
          attributes: {
            coords_decimal_degrees: extraction.coords_decimal_degrees,
            holder_raw: extraction.holder,
            confidence: extraction.confidence,
            extracted_by: 'document-agent.v1',
          },
        });

        const entityWrite = await deps.temporalEntityWriter.insert({
          id: randomUUID(),
          tenantId: input.tenantId,
          entityType: 'licence',
          entityKey: extraction.licence_no,
          attributes: {
            licence_id: licenceWrite.id,
            licence_no: extraction.licence_no,
            holder: extraction.holder,
            mineral: extraction.mineral,
            coords_decimal_degrees: extraction.coords_decimal_degrees,
            granted_at: extraction.granted_at,
            expires_at: extraction.expires_at,
            evidence_quotes: extraction.evidence_quotes,
            rationale: extraction.rationale,
          },
          validFrom: extraction.granted_at,
          validTo: extraction.expires_at,
          confidence: extraction.confidence,
          evidenceIds,
          source: `agent:document-agent.v1 doc:${evidenceIds[0]}`,
        });

        deps.logger?.info('document-agent: wrote licence + temporal entity', {
          licenceId: licenceWrite.id,
          entityId: entityWrite.id,
          confidence: extraction.confidence,
          status,
        });

        return {
          success: true,
          licenceId: licenceWrite.id,
          entityId: entityWrite.id,
          evidenceIds,
          extraction,
        };
      } catch (error) {
        return failure(error, evidenceIds, 'persist_failed');
      }
    },
  };
}

export type DocumentAgent = ReturnType<typeof createDocumentAgent>;

// ─────────────────────────────────────────────────────────────────────
// Default surface — `documentAgent` matches the spec exactly
// ─────────────────────────────────────────────────────────────────────

/**
 * Default surface. Callers can override any port via
 * `createDocumentAgent({...})`; the lazy defaults expect
 * ANTHROPIC_API_KEY and a wired DATABASE_URL.
 */
export const documentAgent = createDocumentAgent({
  pdfReader: createDefaultPdfReader(),
  claude: lazyClaudeClient(),
  licenceWriter: lazyLicenceWriter(),
  temporalEntityWriter: lazyTemporalEntityWriter(),
});

