/**
 * In-memory reference implementations of the repository + storage ports.
 *
 * Two purposes:
 *   1. **Tests** — drive the pipeline end-to-end without a postgres
 *      connection.
 *   2. **RLS contract** — every read enforces a tenant_id match. Tests
 *      use this to assert tenant-A cannot read tenant-B's documents
 *      even when the postgres GUC is not bound. The contract here is the
 *      observable behaviour the postgres adapter must match.
 *
 * Keep these simple — they are NOT a production substrate.
 */

import type {
  IDocumentRepository,
  IExtractionRepository,
  IEntityRepository,
  IRoutingRepository,
  IDocumentStorage,
  IEntityResolver,
  IEventBus,
  CreateDocumentInput,
  CreateExtractionInput,
  CreateEntityInput,
  CreateRoutingInput,
  PutObjectInput,
  EntityCandidate,
  PipelineEvent,
} from './ports.js';
import type {
  Document,
  DocumentEntity,
  Extraction,
  Routing,
  ProcessingState,
} from './types.js';

/**
 * Cross-tenant access is the canonical RLS violation. Repositories throw
 * this when a caller tries to read or mutate another tenant's data.
 */
export class CrossTenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossTenantAccessError';
  }
}

// ─── Document repository ──────────────────────────────────────────────────

export class InMemoryDocumentRepository implements IDocumentRepository {
  private readonly rows = new Map<string, Document>();

  async create(input: CreateDocumentInput): Promise<Document> {
    const now = new Date();
    const doc: Document = {
      id: input.id,
      tenantId: input.tenantId,
      uploadedByUserId: input.uploadedByUserId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storagePath: input.storagePath,
      sha256: input.sha256,
      pageCount: null,
      ocrText: null,
      ocrLanguage: null,
      processingState: 'pending',
      processingError: null,
      sourceChannel: input.sourceChannel,
      relatedThreadId: input.relatedThreadId,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(doc.id, doc);
    return doc;
  }

  async findById(tenantId: string, id: string): Promise<Document | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (row.tenantId !== tenantId) {
      // RLS: cross-tenant read returns null (not error) — same observable
      // behaviour postgres delivers under SELECT-policy isolation.
      return null;
    }
    return row;
  }

  async findBySha256(
    tenantId: string,
    sha256: string,
  ): Promise<Document | null> {
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && row.sha256 === sha256) {
        return row;
      }
    }
    return null;
  }

  async updateState(
    tenantId: string,
    id: string,
    state: ProcessingState,
    extra: {
      ocrText?: string;
      ocrLanguage?: 'en' | 'sw' | 'mixed';
      pageCount?: number;
      processingError?: string;
    } = {},
  ): Promise<Document> {
    const existing = this.rows.get(id);
    if (!existing) {
      throw new Error(`document not found: ${id}`);
    }
    if (existing.tenantId !== tenantId) {
      throw new CrossTenantAccessError(
        `document ${id} not owned by tenant ${tenantId}`,
      );
    }
    const next: Document = {
      ...existing,
      processingState: state,
      ocrText: extra.ocrText !== undefined ? extra.ocrText : existing.ocrText,
      ocrLanguage:
        extra.ocrLanguage !== undefined ? extra.ocrLanguage : existing.ocrLanguage,
      pageCount:
        extra.pageCount !== undefined ? extra.pageCount : existing.pageCount,
      processingError:
        extra.processingError !== undefined
          ? extra.processingError
          : existing.processingError,
      updatedAt: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }

  /** Test-only helper: snapshot of all rows for assertions. */
  snapshot(): ReadonlyArray<Document> {
    return Array.from(this.rows.values());
  }
}

// ─── Extraction repository ────────────────────────────────────────────────

export class InMemoryExtractionRepository implements IExtractionRepository {
  private readonly rows = new Map<string, Extraction>();

  async createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateExtractionInput>,
  ): Promise<ReadonlyArray<Extraction>> {
    const created: Extraction[] = [];
    for (const input of inputs) {
      if (input.tenantId !== tenantId) {
        throw new CrossTenantAccessError(
          `extraction ${input.id} tenant mismatch`,
        );
      }
      const row: Extraction = {
        ...input,
        createdAt: new Date(),
      };
      this.rows.set(row.id, row);
      created.push(row);
    }
    return created;
  }

  async findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<Extraction>> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.documentId === documentId,
    );
  }

  async findById(tenantId: string, id: string): Promise<Extraction | null> {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    return row;
  }

  snapshot(): ReadonlyArray<Extraction> {
    return Array.from(this.rows.values());
  }
}

// ─── Entity repository ────────────────────────────────────────────────────

export class InMemoryEntityRepository implements IEntityRepository {
  private readonly rows = new Map<string, DocumentEntity>();

  async createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>,
  ): Promise<ReadonlyArray<DocumentEntity>> {
    const created: DocumentEntity[] = [];
    for (const input of inputs) {
      if (input.tenantId !== tenantId) {
        throw new CrossTenantAccessError(`entity ${input.id} tenant mismatch`);
      }
      const row: DocumentEntity = { ...input, createdAt: new Date() };
      this.rows.set(row.id, row);
      created.push(row);
    }
    return created;
  }

  async findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<DocumentEntity>> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.documentId === documentId,
    );
  }

  snapshot(): ReadonlyArray<DocumentEntity> {
    return Array.from(this.rows.values());
  }
}

// ─── Routing repository ───────────────────────────────────────────────────

export class InMemoryRoutingRepository implements IRoutingRepository {
  private readonly rows = new Map<string, Routing>();

  async createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateRoutingInput>,
  ): Promise<ReadonlyArray<Routing>> {
    const created: Routing[] = [];
    for (const input of inputs) {
      if (input.tenantId !== tenantId) {
        throw new CrossTenantAccessError(`routing ${input.id} tenant mismatch`);
      }
      const row: Routing = {
        ...input,
        appliedAt: null,
        createdAt: new Date(),
      };
      this.rows.set(row.id, row);
      created.push(row);
    }
    return created;
  }

  async findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<Routing>> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.documentId === documentId,
    );
  }

  snapshot(): ReadonlyArray<Routing> {
    return Array.from(this.rows.values());
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────

export class InMemoryDocumentStorage implements IDocumentStorage {
  private readonly objects = new Map<string, Buffer>();

  async putObject(input: PutObjectInput): Promise<{ storagePath: string }> {
    const storagePath = `tenant/${input.tenantId}/${input.key}`;
    const body =
      typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body;
    this.objects.set(storagePath, body);
    return { storagePath };
  }

  async getObject(tenantId: string, storagePath: string): Promise<Buffer> {
    if (!storagePath.startsWith(`tenant/${tenantId}/`)) {
      throw new CrossTenantAccessError(
        `storage path ${storagePath} not owned by tenant ${tenantId}`,
      );
    }
    const buf = this.objects.get(storagePath);
    if (!buf) {
      throw new Error(`object not found: ${storagePath}`);
    }
    return buf;
  }
}

// ─── Entity resolver (in-memory with simple fuzzy + cosine) ──────────────

export class InMemoryEntityResolver implements IEntityResolver {
  private readonly perTenant = new Map<string, EntityCandidate[]>();

  seed(tenantId: string, candidates: ReadonlyArray<EntityCandidate>): void {
    this.perTenant.set(tenantId, [...candidates]);
  }

  async searchByName(
    tenantId: string,
    query: string,
    limit: number,
  ): Promise<ReadonlyArray<EntityCandidate>> {
    const candidates = this.perTenant.get(tenantId) ?? [];
    const q = query.trim().toLowerCase();
    return candidates
      .map((c) => ({ c, score: stringSimilarity(c.displayName.toLowerCase(), q) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.c);
  }

  async searchByEmbedding(
    tenantId: string,
    embedding: ReadonlyArray<number>,
    limit: number,
  ): Promise<ReadonlyArray<EntityCandidate>> {
    const candidates = this.perTenant.get(tenantId) ?? [];
    return candidates
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length === embedding.length)
      .map((c) => ({ c, score: cosineSimilarity(c.embedding!, embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.c);
  }
}

// ─── Event bus ────────────────────────────────────────────────────────────

export class InMemoryEventBus implements IEventBus {
  readonly events: PipelineEvent[] = [];

  emit(event: PipelineEvent): void {
    this.events.push(event);
  }
}

// ─── Helpers (also exported for direct use by resolve/) ──────────────────

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Token-based Jaccard + Levenshtein hybrid — robust to word swaps + typos.
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(jaccard, edit * 0.9);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let cur: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
