/**
 * Decision Recorder — hash-chained writer for the decision journal.
 *
 * Three append-only writes:
 *   recordDecision(input)  decisions
 *   recordOutcome(input)   decision_outcomes
 *   recordLink(input)      decision_links
 *
 * Every write computes its row hash via @borjie/audit-hash-chain so an
 * auditor can replay verifyChain() over any tenant slice.
 *
 * Tenant isolation lives at the RLS layer via the canonical
 * `app.tenant_id` GUC. The recorder never double-filters.
 *
 * Failure containment:
 *   - Zod-level validation of every field; throws `DecisionRecorderError`
 *     with code `invalid_input` on rejection.
 *   - Persistence failures bubble as code `persistence_failed`.
 *   - Recording an outcome for an unknown decision raises
 *     `unknown_decision` so the caller can retry / log.
 *
 * The recorder is constructed with an injected DB-like + clock + hash
 * primitive so tests can pass an in-memory double + a deterministic
 * clock + a stub chain function.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

import {
  DECIDED_BY_KINDS,
  DECISION_LINK_RELATIONSHIPS,
  DECISION_STATUSES,
  DecisionRecorderError,
  OUTCOME_RECORDERS,
  RETROSPECTIVE_GRADES,
  type DecisionAlternative,
  type DecisionProvenance,
  type RecordedDecision,
  type RecordedLink,
  type RecordedOutcome,
  type RecordDecisionInput,
  type RecordLinkInput,
  type RecordOutcomeInput,
} from './types.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

// ─── input schemas ──────────────────────────────────────────────────

const AlternativeSchema = z
  .object({
    option: z.union([
      z.string().min(1).max(400),
      z.record(z.string(), z.unknown()),
    ]),
    whyNot: z.string().min(1).max(400),
  })
  .strict();

const ProvenanceSchema = z.record(z.string(), z.unknown()).optional();

const RecordDecisionSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    decidedByKind: z.enum(DECIDED_BY_KINDS),
    decidedByActorId: z.string().min(1).max(120),
    decisionSubject: z.string().min(3).max(400),
    decisionSubjectEntityKind: z.string().min(1).max(80).optional().nullable(),
    decisionSubjectEntityId: z.string().min(1).max(120).optional().nullable(),
    decidedValue: z.record(z.string(), z.unknown()),
    alternativesConsidered: z.array(AlternativeSchema).max(8).optional(),
    rationale: z.string().min(3).max(2000),
    confidence: z.number().min(0).max(1).optional().nullable(),
    decidedAt: z.string().datetime().optional(),
    scopeIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    relatedPredictionId: z.string().min(1).max(120).optional().nullable(),
    relatedActionAuditHash: z.string().min(1).max(120).optional().nullable(),
    status: z.enum(DECISION_STATUSES).optional(),
    provenance: ProvenanceSchema,
  })
  .strict();

const RecordOutcomeSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    decisionId: z.string().uuid(),
    outcomeSummary: z.string().min(3).max(2000),
    observedValueTzs: z.number().finite().optional().nullable(),
    observedAt: z.string().datetime().optional(),
    retrospectiveGrade: z.enum(RETROSPECTIVE_GRADES),
    learnings: z.string().max(2000).optional().nullable(),
    recordedBy: z.enum(OUTCOME_RECORDERS),
  })
  .strict();

const RecordLinkSchema = z
  .object({
    tenantId: z.string().min(1).max(80),
    sourceDecisionId: z.string().uuid(),
    targetDecisionId: z.string().uuid(),
    relationship: z.enum(DECISION_LINK_RELATIONSHIPS),
    note: z.string().max(400).optional().nullable(),
  })
  .strict()
  .refine(
    (v) => v.sourceDecisionId !== v.targetDecisionId,
    'source and target decisions must differ',
  );

// ─── recorder factory ───────────────────────────────────────────────

export interface DecisionRecorderDeps {
  readonly db: DbLike;
  readonly now?: () => Date;
  /** Optional HMAC secret for the chain. When provided, every row
   *  hash is HMAC-SHA256 instead of plain SHA-256. The same secret
   *  must be supplied to `verifyChain` at audit time. */
  readonly chainSecret?: string;
  readonly chainSecretId?: string;
}

export interface DecisionRecorder {
  recordDecision(input: RecordDecisionInput): Promise<RecordedDecision>;
  recordOutcome(input: RecordOutcomeInput): Promise<RecordedOutcome>;
  recordLink(input: RecordLinkInput): Promise<RecordedLink>;
}

export function createDecisionRecorder(
  deps: DecisionRecorderDeps,
): DecisionRecorder {
  const now = deps.now ?? (() => new Date());

  async function lastDecisionHash(tenantId: string): Promise<string | null> {
    const rows = rowsOf(
      await deps.db.execute(sql`
        SELECT entry_hash
          FROM decisions
         WHERE tenant_id = ${tenantId}
         ORDER BY decided_at DESC, created_at DESC
         LIMIT 1
      `),
    );
    if (rows.length === 0) return null;
    const head = rows[0]?.entry_hash;
    return typeof head === 'string' && head.length > 0 ? head : null;
  }

  async function lastOutcomeHash(
    tenantId: string,
    decisionId: string,
  ): Promise<string | null> {
    const rows = rowsOf(
      await deps.db.execute(sql`
        SELECT entry_hash
          FROM decision_outcomes
         WHERE tenant_id = ${tenantId}
           AND decision_id = ${decisionId}
         ORDER BY observed_at DESC, created_at DESC
         LIMIT 1
      `),
    );
    if (rows.length === 0) return null;
    const head = rows[0]?.entry_hash;
    return typeof head === 'string' && head.length > 0 ? head : null;
  }

  async function lastLinkHash(
    tenantId: string,
    sourceDecisionId: string,
  ): Promise<string | null> {
    const rows = rowsOf(
      await deps.db.execute(sql`
        SELECT entry_hash
          FROM decision_links
         WHERE tenant_id = ${tenantId}
           AND source_decision_id = ${sourceDecisionId}
         ORDER BY created_at DESC
         LIMIT 1
      `),
    );
    if (rows.length === 0) return null;
    const head = rows[0]?.entry_hash;
    return typeof head === 'string' && head.length > 0 ? head : null;
  }

  function computeHash(prev: string | null, payload: Record<string, unknown>): string {
    const opts: { secretId?: string } = {};
    if (deps.chainSecretId !== undefined) {
      opts.secretId = deps.chainSecretId;
    }
    return chainHash(
      { prev: prev ?? GENESIS_HASH, payload, ...opts },
      deps.chainSecret,
    );
  }

  async function decisionExists(
    tenantId: string,
    decisionId: string,
  ): Promise<boolean> {
    const rows = rowsOf(
      await deps.db.execute(sql`
        SELECT 1 FROM decisions WHERE tenant_id = ${tenantId} AND id = ${decisionId} LIMIT 1
      `),
    );
    return rows.length > 0;
  }

  return Object.freeze({
    async recordDecision(input) {
      const parsed = RecordDecisionSchema.safeParse(input);
      if (!parsed.success) {
        throw new DecisionRecorderError(
          'invalid_input',
          `recordDecision invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const decidedAt = value.decidedAt ?? now().toISOString();
      const alternatives: ReadonlyArray<DecisionAlternative> = Object.freeze(
        (value.alternativesConsidered ?? []) as ReadonlyArray<DecisionAlternative>,
      );
      const scopeIds: ReadonlyArray<string> = Object.freeze(value.scopeIds ?? []);
      const provenance: DecisionProvenance = Object.freeze(
        (value.provenance ?? {}) as DecisionProvenance,
      );
      const status = value.status ?? 'committed';

      const prev = await lastDecisionHash(value.tenantId);
      const payload = {
        tenant_id: value.tenantId,
        decided_by_kind: value.decidedByKind,
        decided_by_actor_id: value.decidedByActorId,
        decision_subject: value.decisionSubject,
        decision_subject_entity_kind: value.decisionSubjectEntityKind ?? null,
        decision_subject_entity_id: value.decisionSubjectEntityId ?? null,
        decided_value: value.decidedValue,
        alternatives_considered: alternatives,
        rationale: value.rationale,
        confidence: value.confidence ?? null,
        decided_at: decidedAt,
        scope_ids: scopeIds,
        related_prediction_id: value.relatedPredictionId ?? null,
        related_action_audit_hash: value.relatedActionAuditHash ?? null,
        status,
        provenance,
      };
      const entryHash = computeHash(prev, payload);

      let rows: ReadonlyArray<ExecRow> = [];
      try {
        rows = rowsOf(
          await deps.db.execute(sql`
            INSERT INTO decisions (
              tenant_id, decided_by_kind, decided_by_actor_id,
              decision_subject, decision_subject_entity_kind,
              decision_subject_entity_id, decided_value,
              alternatives_considered, rationale, confidence,
              decided_at, scope_ids, related_prediction_id,
              related_action_audit_hash, status, provenance,
              entry_hash, prev_hash
            )
            VALUES (
              ${value.tenantId}, ${value.decidedByKind}, ${value.decidedByActorId},
              ${value.decisionSubject}, ${value.decisionSubjectEntityKind ?? null},
              ${value.decisionSubjectEntityId ?? null},
              ${JSON.stringify(value.decidedValue)}::jsonb,
              ${JSON.stringify(alternatives)}::jsonb,
              ${value.rationale}, ${value.confidence ?? null},
              ${decidedAt}::timestamptz, ${scopeIds as unknown as string[]},
              ${value.relatedPredictionId ?? null},
              ${value.relatedActionAuditHash ?? null},
              ${status},
              ${JSON.stringify(provenance)}::jsonb,
              ${entryHash}, ${prev}
            )
            RETURNING id
          `),
        );
      } catch (err) {
        throw new DecisionRecorderError(
          'persistence_failed',
          `recordDecision insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const id = rows[0]?.id;
      if (typeof id !== 'string') {
        throw new DecisionRecorderError(
          'persistence_failed',
          'recordDecision did not return an id',
        );
      }

      return Object.freeze({
        id,
        tenantId: value.tenantId,
        decidedByKind: value.decidedByKind,
        decidedByActorId: value.decidedByActorId,
        decisionSubject: value.decisionSubject,
        decisionSubjectEntityKind: value.decisionSubjectEntityKind ?? null,
        decisionSubjectEntityId: value.decisionSubjectEntityId ?? null,
        decidedValue: Object.freeze({ ...value.decidedValue }),
        alternativesConsidered: alternatives,
        rationale: value.rationale,
        confidence: value.confidence ?? null,
        decidedAt,
        scopeIds,
        relatedPredictionId: value.relatedPredictionId ?? null,
        relatedActionAuditHash: value.relatedActionAuditHash ?? null,
        status,
        provenance,
        entryHash,
        prevHash: prev,
      });
    },

    async recordOutcome(input) {
      const parsed = RecordOutcomeSchema.safeParse(input);
      if (!parsed.success) {
        throw new DecisionRecorderError(
          'invalid_input',
          `recordOutcome invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const exists = await decisionExists(value.tenantId, value.decisionId);
      if (!exists) {
        throw new DecisionRecorderError(
          'unknown_decision',
          `decision ${value.decisionId} not found for tenant ${value.tenantId}`,
        );
      }

      const observedAt = value.observedAt ?? now().toISOString();
      const prev = await lastOutcomeHash(value.tenantId, value.decisionId);
      const payload = {
        tenant_id: value.tenantId,
        decision_id: value.decisionId,
        outcome_summary: value.outcomeSummary,
        observed_value_tzs: value.observedValueTzs ?? null,
        observed_at: observedAt,
        retrospective_grade: value.retrospectiveGrade,
        learnings: value.learnings ?? null,
        recorded_by: value.recordedBy,
      };
      const entryHash = computeHash(prev, payload);

      let rows: ReadonlyArray<ExecRow> = [];
      try {
        rows = rowsOf(
          await deps.db.execute(sql`
            INSERT INTO decision_outcomes (
              tenant_id, decision_id, outcome_summary, observed_value_tzs,
              observed_at, retrospective_grade, learnings, recorded_by,
              entry_hash, prev_hash
            )
            VALUES (
              ${value.tenantId}, ${value.decisionId}, ${value.outcomeSummary},
              ${value.observedValueTzs ?? null},
              ${observedAt}::timestamptz, ${value.retrospectiveGrade},
              ${value.learnings ?? null}, ${value.recordedBy},
              ${entryHash}, ${prev}
            )
            RETURNING id
          `),
        );
      } catch (err) {
        throw new DecisionRecorderError(
          'persistence_failed',
          `recordOutcome insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const id = rows[0]?.id;
      if (typeof id !== 'string') {
        throw new DecisionRecorderError(
          'persistence_failed',
          'recordOutcome did not return an id',
        );
      }

      return Object.freeze({
        id,
        tenantId: value.tenantId,
        decisionId: value.decisionId,
        outcomeSummary: value.outcomeSummary,
        observedValueTzs: value.observedValueTzs ?? null,
        observedAt,
        retrospectiveGrade: value.retrospectiveGrade,
        learnings: value.learnings ?? null,
        recordedBy: value.recordedBy,
        entryHash,
        prevHash: prev,
      });
    },

    async recordLink(input) {
      const parsed = RecordLinkSchema.safeParse(input);
      if (!parsed.success) {
        throw new DecisionRecorderError(
          'invalid_input',
          `recordLink invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const sourceOk = await decisionExists(value.tenantId, value.sourceDecisionId);
      const targetOk = await decisionExists(value.tenantId, value.targetDecisionId);
      if (!sourceOk || !targetOk) {
        throw new DecisionRecorderError(
          'unknown_decision',
          `link references missing decision (source=${value.sourceDecisionId}, target=${value.targetDecisionId})`,
        );
      }

      const prev = await lastLinkHash(value.tenantId, value.sourceDecisionId);
      const payload = {
        tenant_id: value.tenantId,
        source_decision_id: value.sourceDecisionId,
        target_decision_id: value.targetDecisionId,
        relationship: value.relationship,
        note: value.note ?? null,
      };
      const entryHash = computeHash(prev, payload);

      try {
        await deps.db.execute(sql`
          INSERT INTO decision_links (
            tenant_id, source_decision_id, target_decision_id,
            relationship, note, entry_hash, prev_hash
          )
          VALUES (
            ${value.tenantId}, ${value.sourceDecisionId}, ${value.targetDecisionId},
            ${value.relationship}, ${value.note ?? null}, ${entryHash}, ${prev}
          )
        `);
      } catch (err) {
        throw new DecisionRecorderError(
          'persistence_failed',
          `recordLink insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return Object.freeze({
        tenantId: value.tenantId,
        sourceDecisionId: value.sourceDecisionId,
        targetDecisionId: value.targetDecisionId,
        relationship: value.relationship,
        note: value.note ?? null,
        entryHash,
        prevHash: prev,
      });
    },
  });
}
