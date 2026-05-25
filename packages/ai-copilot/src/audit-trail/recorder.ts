/**
 * AuditTrailRecorder — single write entrypoint for every router, orchestrator,
 * and task-agent. Handles:
 *   1. Per-tenant sequence assignment (reads latest, increments)
 *   2. prev_hash linkage to genesis constant on the first row
 *   3. this_hash calculation (SHA-256) over canonicalised row
 *   4. signature calculation (HMAC-SHA256) if signing secret present
 *   5. Delegating insertion to the repository
 *
 * All input validation happens here. The repository trusts whatever the
 * recorder hands it — there is no other write path.
 */

import { randomUUID } from 'crypto';
import type {
  AuditActionCategory,
  AuditActorKind,
  AuditAiEvidence,
  AuditSubject,
  AuditTrailEntry,
  HashChainPort,
  RecordAuditInput,
} from './types.js';
import { GENESIS_PREV_HASH_V2 } from './types.js';
import { hashEntry, signHash } from './hash-chain.js';

// ---------------------------------------------------------------------------
// Validation — tight fences. Bad inputs fail loudly here so the chain never
// ends up with partially-hashed rows.
// ---------------------------------------------------------------------------

const ALLOWED_ACTOR_KINDS: ReadonlySet<AuditActorKind> = new Set([
  'ai_autonomous',
  'ai_proposal',
  'ai_execution',
  'human_approval',
  'human_override',
  'human_action',
  'system',
]);

const ALLOWED_CATEGORIES: ReadonlySet<AuditActionCategory> = new Set([
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal',
  'tenant_welfare',
  'other',
]);

function assertNonEmpty(value: string | undefined | null, field: string): void {
  if (!value || value.trim() === '') {
    throw new Error(`audit-trail: ${field} is required`);
  }
}

function assertInt(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`audit-trail: ${field} must be a non-negative integer`);
  }
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export interface AuditTrailRecorderDeps {
  readonly repo: HashChainPort;
  readonly signingSecret?: string | null;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface AuditTrailRecorder {
  record(input: RecordAuditInput): Promise<AuditTrailEntry>;
}

export function createAuditTrailRecorder(
  deps: AuditTrailRecorderDeps,
): AuditTrailRecorder {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => `at_${randomUUID()}`);
  const secret = deps.signingSecret ?? null;

  return {
    async record(input) {
      // 1. Validation ----------------------------------------------------
      assertNonEmpty(input.tenantId, 'tenantId');
      assertNonEmpty(input.actionKind, 'actionKind');
      if (!ALLOWED_ACTOR_KINDS.has(input.actor.kind)) {
        throw new Error(
          `audit-trail: invalid actor.kind "${input.actor.kind}"`,
        );
      }
      if (!ALLOWED_CATEGORIES.has(input.actionCategory)) {
        throw new Error(
          `audit-trail: invalid actionCategory "${input.actionCategory}"`,
        );
      }
      const ai: AuditAiEvidence = input.ai ?? {};
      assertInt(ai.promptTokensIn ?? null, 'ai.promptTokensIn');
      assertInt(ai.promptTokensOut ?? null, 'ai.promptTokensOut');
      assertInt(ai.costUsdMicro ?? null, 'ai.costUsdMicro');

      // 2. Sequence + prev_hash -----------------------------------------
      const latest = await deps.repo.getLatest(input.tenantId);
      const sequenceId = (latest?.sequenceId ?? 0) + 1;
      const prevHash = latest?.thisHash ?? GENESIS_PREV_HASH_V2;

      // 3. Build evidence blob ------------------------------------------
      const subject: AuditSubject = input.subject ?? {};
      const occurredAt = (input.occurredAt ?? now()).toISOString();
      const decision = input.decision ?? 'executed';

      // Evidence JSON carries BOTH the AI evidence AND the attachments so
      // the hash covers every field the row presents to consumers.
      const evidence: Readonly<Record<string, unknown>> = {
        ...(ai.attachments ?? {}),
        // Pinned model-evidence keys — stored under reserved `_ai` key so
        // user attachments can never collide with them.
        _ai: {
          modelVersion: ai.modelVersion ?? null,
          promptHash: ai.promptHash ?? null,
          promptTokensIn: ai.promptTokensIn ?? null,
          promptTokensOut: ai.promptTokensOut ?? null,
          costUsdMicro: ai.costUsdMicro ?? null,
        },
        _subject: {
          entityType: subject.entityType ?? null,
          entityId: subject.entityId ?? null,
          resourceUri: subject.resourceUri ?? null,
        },
        _actor: {
          id: input.actor.id ?? null,
          display: input.actor.display ?? null,
        },
      };

      // 4. Hash + sign ---------------------------------------------------
      const thisHash = hashEntry({
        sequenceId,
        prevHash,
        tenantId: input.tenantId,
        occurredAt,
        actorKind: input.actor.kind,
        actionKind: input.actionKind,
        actionCategory: input.actionCategory,
        decision,
        evidence,
      });
      const signature = signHash(thisHash, secret);

      // 5. Persist -------------------------------------------------------
      const row: AuditTrailEntry = {
        id: genId(),
        tenantId: input.tenantId,
        sequenceId,
        occurredAt,
        actorKind: input.actor.kind,
        actorId: input.actor.id ?? null,
        actorDisplay: input.actor.display ?? null,
        actionKind: input.actionKind,
        actionCategory: input.actionCategory,
        subjectEntityType: subject.entityType ?? null,
        subjectEntityId: subject.entityId ?? null,
        resourceUri: subject.resourceUri ?? null,
        aiModelVersion: ai.modelVersion ?? null,
        promptHash: ai.promptHash ?? null,
        promptTokensIn: ai.promptTokensIn ?? null,
        promptTokensOut: ai.promptTokensOut ?? null,
        costUsdMicro: ai.costUsdMicro ?? null,
        evidence,
        decision,
        prevHash,
        thisHash,
        signature,
        createdAt: occurredAt,
      };

      return deps.repo.insert(row);
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory repository — used by tests and by dev fallback when DB is unset.
// Exported separately from `repository.ts`? No — tiny enough to co-locate.
// ---------------------------------------------------------------------------

import type {
  AuditTrailRepository,
  VerifyRangeResult,
} from './types.js';

export function createInMemoryAuditTrailRepo(): AuditTrailRepository & {
  readonly entries: readonly AuditTrailEntry[];
  tamper(index: number, mutation: Partial<AuditTrailEntry>): void;
  clear(): void;
} {
  const rows: AuditTrailEntry[] = [];

  const filterFn = (
    tenantId: string,
    options?: {
      readonly from?: Date;
      readonly to?: Date;
      readonly category?: AuditActionCategory;
      readonly actorKind?: AuditActorKind;
    },
  ) => (r: AuditTrailEntry): boolean => {
    if (r.tenantId !== tenantId) return false;
    if (options?.from && new Date(r.occurredAt) < options.from) return false;
    if (options?.to && new Date(r.occurredAt) > options.to) return false;
    if (options?.category && r.actionCategory !== options.category) return false;
    if (options?.actorKind && r.actorKind !== options.actorKind) return false;
    return true;
  };

  return {
    get entries() {
      return rows.map((r) => ({ ...r, evidence: { ...r.evidence } }));
    },
    async insert(entry) {
      rows.push({ ...entry, evidence: { ...entry.evidence } });
      return { ...entry, evidence: { ...entry.evidence } };
    },
    async getLatest(tenantId) {
      const scoped = rows.filter((r) => r.tenantId === tenantId);
      if (scoped.length === 0) return null;
      const last = scoped.reduce((acc, r) =>
        r.sequenceId > acc.sequenceId ? r : acc,
      );
      return { ...last, evidence: { ...last.evidence } };
    },
    async list(tenantId, options) {
      const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
      const offset = options?.offset ?? 0;
      return rows
        .filter(filterFn(tenantId, options))
        .sort((a, b) => a.sequenceId - b.sequenceId)
        .slice(offset, offset + limit)
        .map((r) => ({ ...r, evidence: { ...r.evidence } }));
    },
    async count(tenantId, options) {
      return rows.filter(filterFn(tenantId, options)).length;
    },
    tamper(index, mutation) {
      if (index < 0 || index >= rows.length) return;
      rows[index] = { ...rows[index], ...mutation } as AuditTrailEntry;
    },
    clear() {
      rows.length = 0;
    },
  };
}

// Avoid unused-import warnings — the types are re-used in the in-memory repo.
export type { VerifyRangeResult };
