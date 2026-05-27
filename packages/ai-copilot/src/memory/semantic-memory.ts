/**
 * BORJIE AI semantic memory — Wave-11 (+ PersonLayer overlay).
 *
 * Per-tenant, per-persona long-lived memory. Backed by the
 * `ai_semantic_memories` table (see 0038_ai_semantic_memory.sql). Embeddings
 * are computed by an injected embedder so tests can use a deterministic
 * hash-based stand-in and production can plug in OpenAI / a local model.
 *
 * Every read/write is tenant-scoped; the repository port intentionally
 * requires `tenantId` on every call so we cannot accidentally spill memories
 * across organisations.
 *
 * PersonLayer overlay (Docs/research/unified-personal-kb.md §5):
 *   `recall()` accepts an optional `personId`. When set, the recall path
 *   loads the person's federated cells via `loadPersonLayer` and
 *   UNION-ALLs them into the result set with a `-0.1` similarity penalty
 *   on cross-tenant rows. The wall is enforced *before* the union: a
 *   Chinese-wall verdict drops every cross-tenant numeric cell, and
 *   k-anonymity (k>=3) gates count-style claims.
 */

import {
  loadPersonLayer,
  type PersonalMemoryCell,
  type PersonLayerDrizzleClient,
  type PersonLayerSqlTemplate,
} from './person-layer.js';
import { enforceChineseWall } from './boundary-tagger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType =
  | 'interaction'
  | 'preference'
  | 'decision'
  | 'relationship'
  | 'learning';

/**
 * Per-cell penalty applied to cross-tenant person-layer rows. Keeps
 * tenant-native cells naturally ranked above federated personal cells
 * with equivalent semantic similarity. Value chosen per R8 spec.
 */
export const PERSON_LAYER_CROSS_TENANT_PENALTY = 0.1;

export interface SemanticMemoryRow {
  readonly id: string;
  readonly tenantId: string;
  readonly personaId: string | null;
  readonly memoryType: MemoryType;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly decayScore: number;
  readonly accessCount: number;
  readonly sessionId: string | null;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly expiresAt: string | null;
}

export interface RememberInput {
  readonly tenantId: string;
  readonly personaId?: string;
  readonly memoryType?: MemoryType;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly confidence?: number;
  readonly sessionId?: string;
  readonly expiresInDays?: number;
}

export interface RecallResult {
  readonly memory: SemanticMemoryRow;
  readonly similarity: number;
}

export interface SemanticMemoryRepository {
  insert(row: SemanticMemoryRow): Promise<SemanticMemoryRow>;
  listForTenant(
    tenantId: string,
    options?: { readonly personaId?: string; readonly limit?: number },
  ): Promise<readonly SemanticMemoryRow[]>;
  touch(id: string, lastAccessedAt: string, accessCount: number): Promise<void>;
  updateDecay(id: string, decayScore: number): Promise<void>;
  deleteById(tenantId: string, id: string): Promise<void>;
}

export type Embedder = (text: string) => Promise<readonly number[]>;

/**
 * Pluggable PersonLayer client. The default uses `loadPersonLayer`
 * directly against a Drizzle client; tests inject a deterministic stub.
 */
export interface PersonLayerClient {
  load(args: {
    readonly personId: string;
    readonly currentTenantId: string;
  }): Promise<{
    readonly preferences: ReadonlyArray<PersonalMemoryCell>;
    readonly context: ReadonlyArray<PersonalMemoryCell>;
    readonly recurringFacts: ReadonlyArray<PersonalMemoryCell>;
    readonly calibration: ReadonlyArray<PersonalMemoryCell>;
  }>;
}

export interface SemanticMemoryDeps {
  readonly repo: SemanticMemoryRepository;
  readonly embedder: Embedder;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  /**
   * Optional PersonLayer overlay. When provided AND the caller passes
   * `personId` to `recall()`, the federated personal cells are loaded
   * and unioned into the result. Absent → recall is tenant-only
   * (existing behaviour).
   */
  readonly personLayer?: PersonLayerClient;
}

export interface RecallOptions {
  readonly personaId?: string;
  readonly limit?: number;
  readonly minSimilarity?: number;
  /**
   * Optional federated personId — when present, the recall path loads
   * the person's `personal_memory_cells` rows via PersonLayer and
   * UNIONs them into the result set, after running them through the
   * Chinese-wall boundary-tagger. Backwards-compatible — when absent,
   * recall behaves exactly as before.
   */
  readonly personId?: string;
}

export interface SemanticMemory {
  remember(input: RememberInput): Promise<SemanticMemoryRow | null>;
  recall(
    tenantId: string,
    query: string,
    options?: RecallOptions,
  ): Promise<readonly RecallResult[]>;
  buildPromptLayer(recall: readonly RecallResult[]): string;
}

/**
 * Build a PersonLayer client backed by a live Drizzle connection. Pass
 * this on `SemanticMemoryDeps` to wire the federated personal-memory
 * overlay into the live recall path.
 */
export function createDrizzlePersonLayerClient(args: {
  readonly db: PersonLayerDrizzleClient;
  readonly sqlTemplate?: PersonLayerSqlTemplate;
  readonly perKindLimit?: number;
}): PersonLayerClient {
  return {
    async load({ personId, currentTenantId }) {
      return loadPersonLayer({
        personId,
        currentTenantId,
        db: args.db,
        ...(args.sqlTemplate ? { sqlTemplate: args.sqlTemplate } : {}),
        ...(args.perKindLimit !== undefined
          ? { perKindLimit: args.perKindLimit }
          : {}),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cosine similarity between two equally-sized vectors. Returns 0 on length mismatch. */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Deterministic hash-based embedder. NOT a real semantic embedder but good
 * enough for test fixtures AND as a fallback when no upstream model is
 * configured.
 */
export function createHashEmbedder(dims = 64): Embedder {
  return async (text: string) => {
    const vec = new Array<number>(dims).fill(0);
    const cleaned = text.toLowerCase();
    for (let i = 0; i < cleaned.length; i++) {
      const code = cleaned.charCodeAt(i);
      const idx = code % dims;
      vec[idx] = (vec[idx] ?? 0) + 1;
    }
    // L2 normalise so similarity is scale-invariant.
    let mag = 0;
    for (let i = 0; i < dims; i++) {
      const vi = vec[i] ?? 0;
      mag += vi * vi;
    }
    mag = Math.sqrt(mag);
    if (mag === 0) return vec;
    return vec.map((v) => v / mag);
  };
}

function validateNonEmpty(value: string | undefined, field: string): void {
  if (!value || value.trim() === '') {
    throw new Error(`semantic-memory: ${field} is required`);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createSemanticMemory(deps: SemanticMemoryDeps): SemanticMemory {
  const now = deps.now ?? (() => new Date());
  const genId =
    deps.idGenerator ??
    (() => `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

  return {
    async remember(input) {
      validateNonEmpty(input.tenantId, 'tenantId');
      validateNonEmpty(input.content, 'content');
      if (input.content.trim().length < 3) return null;

      const embedding = await deps.embedder(input.content);
      const nowIso = now().toISOString();
      const expiresAt =
        typeof input.expiresInDays === 'number' && input.expiresInDays > 0
          ? new Date(now().getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

      const row: SemanticMemoryRow = {
        id: genId(),
        tenantId: input.tenantId,
        personaId: input.personaId ?? null,
        memoryType: input.memoryType ?? 'interaction',
        content: input.content.trim(),
        embedding,
        metadata: input.metadata ? { ...input.metadata } : {},
        confidence: clamp01(input.confidence ?? 0.8),
        decayScore: 1.0,
        accessCount: 0,
        sessionId: input.sessionId ?? null,
        createdAt: nowIso,
        lastAccessedAt: nowIso,
        expiresAt,
      };

      return deps.repo.insert(row);
    },

    async recall(tenantId, query, options) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonEmpty(query, 'query');
      const limit = options?.limit ?? 5;
      const minSim = options?.minSimilarity ?? 0.2;
      const candidates = await deps.repo.listForTenant(tenantId, {
        ...(options?.personaId !== undefined ? { personaId: options.personaId } : {}),
        limit: Math.max(limit * 10, 100),
      });

      const queryVec = await deps.embedder(query);
      const scored = candidates
        .filter((c) => {
          if (!c.expiresAt) return true;
          return new Date(c.expiresAt).getTime() > now().getTime();
        })
        .map((memory) => ({
          memory,
          similarity:
            cosineSimilarity(queryVec, memory.embedding) * memory.decayScore,
        }))
        .filter((r) => r.similarity >= minSim);

      // PersonLayer overlay — additive, never replaces tenant results.
      const personId = options?.personId;
      const personLayer = deps.personLayer;
      const personRows: RecallResult[] =
        personId && personLayer
          ? await loadAndScorePersonLayer({
              tenantId,
              personId,
              personLayer,
              queryVec,
              minSim,
            })
          : [];

      const unioned = [...scored, ...personRows]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      // Fire-and-forget touch — never block the recall path. Person
      // cells live in personal_memory_cells (separate table) and have
      // no `touch` semantic — we only touch the tenant rows.
      const touchAt = now().toISOString();
      for (const r of unioned) {
        if (r.memory.tenantId !== '__person__') {
          deps.repo
            .touch(r.memory.id, touchAt, r.memory.accessCount + 1)
            .catch(() => {
              /* non-critical */
            });
        }
      }

      return unioned;
    },

    buildPromptLayer(recall) {
      if (recall.length === 0) return '';
      const lines: string[] = [
        '[RELATIONSHIP MEMORY — facts recalled about this tenant:]',
      ];
      for (const r of recall) {
        const pct = Math.round(r.similarity * 100);
        lines.push(
          `- (${r.memory.memoryType}, confidence: ${pct}%) ${r.memory.content}`,
        );
      }
      lines.push('[/RELATIONSHIP MEMORY]');
      return lines.join('\n');
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ---------------------------------------------------------------------------
// PersonLayer scoring helper
// ---------------------------------------------------------------------------

/**
 * Renders a personal_memory_cells row as a SemanticMemoryRow look-alike
 * so the existing prompt-layer formatter / sort logic does not need to
 * branch. The synthetic `tenantId === '__person__'` sentinel lets the
 * recall path skip the `touch` write (those cells live in a different
 * table). Confidence is folded into the similarity score.
 */
function personCellToRow(
  cell: PersonalMemoryCell,
  vec: readonly number[],
): SemanticMemoryRow {
  const memoryType: MemoryType =
    cell.cellKind === 'preference'
      ? 'preference'
      : cell.cellKind === 'calibration'
        ? 'learning'
        : cell.cellKind === 'recurring-fact'
          ? 'relationship'
          : 'interaction';
  const content = formatPersonCellAsText(cell);
  return Object.freeze({
    id: cell.id,
    tenantId: '__person__',
    personaId: null,
    memoryType,
    content,
    embedding: vec,
    metadata: {
      origin: 'person_layer',
      cellKind: cell.cellKind,
      key: cell.key,
      sourceTenantId: cell.sourceTenantId,
      sourceThreadId: cell.sourceThreadId,
    } as Record<string, unknown>,
    confidence: cell.confidence,
    decayScore: 1.0,
    accessCount: 0,
    sessionId: null,
    createdAt: cell.capturedAt,
    lastAccessedAt: cell.capturedAt,
    expiresAt: cell.expiresAt,
  });
}

function formatPersonCellAsText(cell: PersonalMemoryCell): string {
  try {
    const payload = JSON.stringify(cell.value);
    return `[${cell.cellKind}:${cell.key}] ${payload}`;
  } catch {
    return `[${cell.cellKind}:${cell.key}] (unserialisable value)`;
  }
}

interface LoadAndScorePersonLayerArgs {
  readonly tenantId: string;
  readonly personId: string;
  readonly personLayer: PersonLayerClient;
  readonly queryVec: readonly number[];
  readonly minSim: number;
}

async function loadAndScorePersonLayer(
  args: LoadAndScorePersonLayerArgs,
): Promise<RecallResult[]> {
  let layer: Awaited<ReturnType<PersonLayerClient['load']>>;
  try {
    layer = await args.personLayer.load({
      personId: args.personId,
      currentTenantId: args.tenantId,
    });
  } catch {
    // Person layer is additive — never break tenant recall on
    // person-layer errors.
    return [];
  }

  // Run the wall before scoring. Blocked cells never reach the LLM.
  const verdict = enforceChineseWall({
    personLayerData: layer,
    currentTenantId: args.tenantId,
  });

  const rows: RecallResult[] = [];
  for (const cell of verdict.allowedFacts) {
    const row = personCellToRow(cell, args.queryVec);
    // Person cells share the query vector so cosine = 1; we then bias
    // the rank by `confidence` and apply a cross-tenant penalty.
    const baseSim = clamp01(cell.confidence);
    const isCrossTenant =
      cell.sourceTenantId !== null && cell.sourceTenantId !== args.tenantId;
    const penalised = isCrossTenant
      ? Math.max(0, baseSim - PERSON_LAYER_CROSS_TENANT_PENALTY)
      : baseSim;
    if (penalised < args.minSim) continue;
    rows.push({ memory: row, similarity: penalised });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// In-memory repository (tests / local dev)
// ---------------------------------------------------------------------------

export function createInMemorySemanticMemoryRepo(): SemanticMemoryRepository {
  const rows = new Map<string, SemanticMemoryRow>();
  return {
    async insert(row) {
      rows.set(row.id, { ...row, embedding: [...row.embedding] });
      return row;
    },
    async listForTenant(tenantId, options) {
      const all = Array.from(rows.values()).filter(
        (r) => r.tenantId === tenantId,
      );
      const scoped =
        options?.personaId === undefined
          ? all
          : all.filter((r) => r.personaId === options.personaId);
      const limit = options?.limit ?? scoped.length;
      return scoped.slice(0, limit);
    },
    async touch(id, lastAccessedAt, accessCount) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, { ...existing, lastAccessedAt, accessCount });
    },
    async updateDecay(id, decayScore) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, { ...existing, decayScore });
    },
    async deleteById(tenantId, id) {
      const existing = rows.get(id);
      if (!existing || existing.tenantId !== tenantId) return;
      rows.delete(id);
    },
  };
}
