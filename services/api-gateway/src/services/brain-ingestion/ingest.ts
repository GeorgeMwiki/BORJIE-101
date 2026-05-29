/**
 * Company-Brain ingestion orchestrator — Wave COMPANY-BRAIN (C-1).
 *
 * Drives the full lifecycle for a single upload:
 *
 *   pending → parsing → chunking → embedded → indexed
 *           ↘ failed (any step)
 *
 * Each lifecycle transition writes back to `corpus_doc_uploads.status` so
 * the live progress meter on the owner UI reflects the current step.
 * The orchestrator never throws on a parser / embedder / summariser
 * failure: it lands the failure on the upload row (status='failed',
 * error_message='...') and returns a partial receipt so the owner sees
 * what went wrong.
 */

import type { Embedder } from './embedder.js';
import type { IngestionPersistence } from './persistence.js';
import { embedChunks } from './embedder.js';
import { chunkText } from './chunker.js';
import { parseIncomingDoc } from './parser.js';
import { summariseDoc } from './summarizer.js';
import { growKnowledgeGraphFromDoc } from '../knowledge-graph/grower.js';
import type {
  IngestReceipt,
  IngestRequest,
  Summary,
} from './types.js';

export interface IngestionDeps {
  readonly persistence: IngestionPersistence;
  readonly embedder: Embedder;
  /** Optional logger — Pino-shaped. */
  readonly logger?:
    | {
        info(obj: Record<string, unknown>, msg?: string): void;
        warn(obj: Record<string, unknown>, msg?: string): void;
        error(obj: Record<string, unknown>, msg?: string): void;
      }
    | undefined;
}

export async function ingest(
  deps: IngestionDeps,
  req: IngestRequest,
): Promise<IngestReceipt> {
  const log = deps.logger;
  const { tenantId, userId, doc, storageUrl } = req;

  // ─── 1. Insert the upload row at status='pending' ────────────────
  const sizeBytes = doc.bytes
    ? doc.bytes.byteLength
    : doc.text
      ? Buffer.byteLength(doc.text, 'utf8')
      : 0;
  const { uploadId } = await deps.persistence.insertUpload({
    tenantId,
    uploadedByUserId: userId,
    sourceKind: doc.sourceKind,
    originalFilename: doc.originalFilename,
    sizeBytes,
    storageUrl,
    metadata: {
      ...(doc.metadata ?? {}),
      ...(doc.mimeType !== undefined ? { mimeType: doc.mimeType } : {}),
      ...(doc.languageHint !== undefined
        ? { languageHint: doc.languageHint }
        : {}),
    },
  });
  log?.info(
    {
      tenantId,
      userId,
      uploadId,
      sourceKind: doc.sourceKind,
      sizeBytes,
    },
    'brain-ingest: upload row inserted',
  );

  // ─── 2. Parse ────────────────────────────────────────────────────
  await deps.persistence.updateUploadStatus({ uploadId, status: 'parsing' });
  let parsed;
  try {
    parsed = await parseIncomingDoc(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn({ tenantId, uploadId, error: message }, 'brain-ingest: parse failed');
    await deps.persistence.updateUploadStatus({
      uploadId,
      status: 'failed',
      errorMessage: message,
      markProcessed: true,
    });
    return failedReceipt(uploadId, message);
  }

  // ─── 3. Chunk ────────────────────────────────────────────────────
  await deps.persistence.updateUploadStatus({ uploadId, status: 'chunking' });
  const chunks = chunkText(parsed.text, { seed: uploadId });
  log?.info(
    { tenantId, uploadId, chunks: chunks.length },
    'brain-ingest: chunked',
  );

  // Edge case: parser returned empty text (e.g. unsupported binary). We
  // still want the upload row to survive — write a single placeholder
  // chunk so the lineage is preserved, then mark status='indexed' with
  // a warning. The owner sees the doc in their list and can re-process.
  const effectiveChunks =
    chunks.length === 0
      ? chunkText(
          `[ingested ${doc.originalFilename} — no extractable text]`,
          { seed: uploadId },
        )
      : chunks;

  // ─── 4. Embed ────────────────────────────────────────────────────
  let embedded;
  try {
    embedded = await embedChunks(deps.embedder, effectiveChunks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(
      { tenantId, uploadId, error: message },
      'brain-ingest: embed failed',
    );
    await deps.persistence.updateUploadStatus({
      uploadId,
      status: 'failed',
      errorMessage: `embed: ${message}`,
      markProcessed: true,
    });
    return failedReceipt(uploadId, message);
  }
  await deps.persistence.updateUploadStatus({
    uploadId,
    status: 'embedded',
    chunksCount: embedded.length,
  });

  // ─── 5. Persist chunks ───────────────────────────────────────────
  try {
    await deps.persistence.upsertChunks({
      tenantId,
      uploadId,
      originalFilename: doc.originalFilename,
      chunks: embedded,
      language: parsed.detectedLanguage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.error(
      { tenantId, uploadId, error: message },
      'brain-ingest: chunk persistence failed',
    );
    await deps.persistence.updateUploadStatus({
      uploadId,
      status: 'failed',
      errorMessage: `persist_chunks: ${message}`,
      markProcessed: true,
    });
    return failedReceipt(uploadId, message);
  }

  // ─── 6. Knowledge-graph growth (entity discovery + cross-refs) ──
  let entitiesExtracted = 0;
  const previewEntities: Array<{ kind: string; displayName: string }> = [];
  try {
    const growth = await growKnowledgeGraphFromDoc({
      tenantId,
      uploadId,
      originalFilename: doc.originalFilename,
      parsed,
      chunks: effectiveChunks,
    });
    entitiesExtracted = growth.entitiesExtracted;
    for (const e of growth.previewEntities) {
      previewEntities.push({ kind: e.kind, displayName: e.displayName });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(
      { tenantId, uploadId, error: message },
      'brain-ingest: kg growth failed (non-fatal)',
    );
  }

  // ─── 7. Summarise + persist summary ──────────────────────────────
  let summary: Summary | null = null;
  try {
    summary = await summariseDoc({
      tenantId,
      filename: doc.originalFilename,
      sourceKind: doc.sourceKind,
      parsed,
    });
    await deps.persistence.insertSummary({
      tenantId,
      uploadId,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(
      { tenantId, uploadId, error: message },
      'brain-ingest: summarise failed (non-fatal)',
    );
  }

  // ─── 8. Mark indexed ─────────────────────────────────────────────
  await deps.persistence.updateUploadStatus({
    uploadId,
    status: 'indexed',
    chunksCount: embedded.length,
    entitiesExtracted,
    markProcessed: true,
  });

  return Object.freeze({
    uploadId,
    status: 'indexed' as const,
    chunksCount: embedded.length,
    entitiesExtracted,
    summary,
    warnings: parsed.warnings,
    previewEntities: Object.freeze(previewEntities.slice(0, 5)),
  });
}

function failedReceipt(uploadId: string, message: string): IngestReceipt {
  return Object.freeze({
    uploadId,
    status: 'failed' as const,
    chunksCount: 0,
    entitiesExtracted: 0,
    summary: null,
    warnings: Object.freeze([message]),
    previewEntities: Object.freeze([]),
    errorMessage: message,
  });
}
