/**
 * Ingest stage. Accept file, dedupe via sha256, persist to storage,
 * write canonical `documents` row, emit `ingested` event.
 *
 * Idempotent: re-uploading the same content under the same tenant
 * returns the existing row (no new sha256 write). Cross-tenant uploads
 * of the same content are isolated — each tenant gets its own row.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  IDocumentRepository,
  IDocumentStorage,
  IEventBus,
} from './ports.js';
import { IngestInputSchema, type Document, type IngestInput } from './types.js';

export interface IngestResult {
  readonly document: Document;
  /** True if this content existed for the tenant; we returned the row unchanged. */
  readonly deduped: boolean;
}

export interface IngestDeps {
  readonly documents: IDocumentRepository;
  readonly storage: IDocumentStorage;
  readonly events: IEventBus;
  /** Inject a clock + id generator for deterministic tests. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/**
 * Compute lowercase-hex sha256 of the content. Works for Buffer and string.
 */
export function sha256Of(content: Buffer | string): string {
  const buf =
    typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Sanitise a filename so it is safe to use as part of a storage key.
 * Drops anything that's not alphanumeric, dash, underscore, or dot.
 * Truncates to 200 chars. Defends against path traversal in the key.
 */
export function sanitiseFilenameForStorage(filename: string): string {
  const base = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
  // Avoid leading dots that would create hidden files in some adapters.
  return base.startsWith('.') ? `_${base}` : base;
}

/**
 * Single entry-point for the ingest stage.
 */
export async function ingestDocument(
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const validated = IngestInputSchema.parse(input);
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => randomUUID());

  const sha256 = sha256Of(validated.content);
  const existing = await deps.documents.findBySha256(validated.tenantId, sha256);
  if (existing) {
    deps.events.emit({
      tenantId: validated.tenantId,
      documentId: existing.id,
      stage: 'ingested',
      at: now(),
      metadata: { deduped: true, sha256 },
    });
    return { document: existing, deduped: true };
  }

  const sizeBytes =
    typeof validated.content === 'string'
      ? Buffer.byteLength(validated.content, 'utf8')
      : validated.content.byteLength;

  const id = newId();
  const objectKey = `${id}/${sanitiseFilenameForStorage(validated.filename)}`;
  const { storagePath } = await deps.storage.putObject({
    tenantId: validated.tenantId,
    key: objectKey,
    body: validated.content,
    mimeType: validated.mimeType,
  });

  const document = await deps.documents.create({
    id,
    tenantId: validated.tenantId,
    uploadedByUserId: validated.uploadedByUserId ?? null,
    filename: validated.filename,
    mimeType: validated.mimeType,
    sizeBytes,
    storagePath,
    sha256,
    sourceChannel: validated.sourceChannel ?? null,
    relatedThreadId: validated.relatedThreadId ?? null,
  });

  deps.events.emit({
    tenantId: validated.tenantId,
    documentId: document.id,
    stage: 'ingested',
    at: now(),
    metadata: { sha256, sizeBytes, mimeType: validated.mimeType },
  });

  return { document, deduped: false };
}
