/**
 * Promoter — orchestration layer.
 *
 * Takes a vetted CandidateSkill (verdict='promote' from the gate) and
 * writes it to the skill registry via an injected `SkillRegistryWriter`
 * port. The production wiring (Drizzle service over `skill_registry`)
 * is in `packages/database`; the test wiring is an in-memory map.
 *
 * Idempotency guarantee — Voyager requires a skill be promotable
 * exactly once per (tenant, code-hash) pair. Two strategies are
 * combined:
 *
 *   1. Pre-check: call `findByCodeHash`; if a row already exists, return
 *      `{ promoted: false }` without writing — second call with the same
 *      candidate is a no-op (counter-bumps come from explicit calls
 *      with `incremental: true`).
 *   2. Post-defence: `upsertSkill` returns `true` only on a genuine
 *      insert. The Drizzle implementation uses `ON CONFLICT DO UPDATE
 *      RETURNING (xmax = 0)` so concurrent promoters in two replicas
 *      collapse to one row.
 *
 * The promoter is *pure orchestration* — it builds the PromotionRecord
 * deterministically from the CandidateSkill and delegates the actual
 * write. No SQL, no timers, no retries here.
 */

import type {
  CandidateSkill,
  PromotionRecord,
  SkillRegistryWriter,
  ToolCall,
} from './types.js';

export interface PromoterDeps {
  readonly registry: SkillRegistryWriter;
}

export interface PromoteResult {
  /** True ⇒ new row inserted. False ⇒ row already existed (idempotent no-op). */
  readonly promoted: boolean;
  readonly record: PromotionRecord;
}

/**
 * Build the canonical skill name from the tool sequence.
 *
 * Example: [ledger.fetch, mpesa.match, ledger.post]
 *       → "skill__ledger.fetch_to_mpesa.match_to_ledger.post"
 *
 * The `skill__` prefix prevents collision with hand-authored skills in
 * the registry; the `_to_` separator is unambiguous against tool names
 * that already contain dots.
 */
function deriveSkillName(toolSequence: readonly ToolCall[]): string {
  const names = toolSequence.map((c) => c.toolName).join('_to_');
  return `skill__${names}`;
}

/** Build the NL description used to seed the retrieval embedding. */
function deriveDescription(toolSequence: readonly ToolCall[]): string {
  const names = toolSequence.map((c) => c.toolName).join(' → ');
  return `Auto-promoted Voyager skill: tool sequence ${names}.`;
}

/**
 * Build the tool-call template the kernel replays once the retriever
 * picks this skill. Shape is intentionally minimal — `steps[]` of
 * `{ toolName, inputShape? }` — because the kernel binds runtime
 * arguments at replay time; the template only commits the *order*.
 */
function deriveTemplate(
  toolSequence: readonly ToolCall[],
): Readonly<Record<string, unknown>> {
  return {
    kind: 'voyager_skill_v1' as const,
    steps: toolSequence.map((c) => ({
      toolName: c.toolName,
      inputShape: c.inputShape ?? null,
    })),
  };
}

/** Build the PromotionRecord deterministically from a CandidateSkill. */
export function buildPromotionRecord(
  candidate: CandidateSkill,
): PromotionRecord {
  return {
    tenantId: candidate.tenantId,
    name: deriveSkillName(candidate.toolSequence),
    nlDescription: deriveDescription(candidate.toolSequence),
    codeHash: candidate.codeHash,
    toolCallTemplate: deriveTemplate(candidate.toolSequence),
    initialSuccessCount: candidate.successCount,
    initialFailureCount: candidate.failureCount,
  };
}

/**
 * Promote a single CandidateSkill.
 *
 * Idempotent: calling with the same candidate twice is safe — second call
 * detects the existing row and returns `{ promoted: false }`. Use a
 * separate "bump counters" path in the consolidation worker if you want
 * to accumulate stats; this function deliberately does not mutate
 * existing rows so the audit trail stays tidy.
 *
 * Returns `null` if the input is not eligible (no calls in sequence).
 */
export async function promoteSkill(
  candidate: CandidateSkill,
  deps: PromoterDeps,
): Promise<PromoteResult | null> {
  if (candidate.toolSequence.length === 0) return null;

  const record = buildPromotionRecord(candidate);

  // Pre-check: idempotency guard. Cheap in production (indexed lookup
  // on (tenant_id, code_hash) unique index from skill-registry.schema).
  const existing = await deps.registry.findByCodeHash(
    record.tenantId,
    record.codeHash,
  );
  if (existing) {
    return { promoted: false, record };
  }

  const inserted = await deps.registry.upsertSkill(record);
  return { promoted: inserted, record };
}

// ---------------------------------------------------------------------------
// In-memory registry — used by tests and dry-run harnesses.
// ---------------------------------------------------------------------------

/**
 * Factory for an in-memory SkillRegistryWriter. Deliberately exported
 * from this module (and re-exported from `index.ts`) so eval harnesses
 * and tests can run the full pipeline without touching Postgres.
 *
 * Returns an object with the writer + a `snapshot()` helper for tests.
 */
export function createInMemorySkillRegistry(): {
  readonly writer: SkillRegistryWriter;
  snapshot(): readonly PromotionRecord[];
} {
  const rows = new Map<string, PromotionRecord>();
  const key = (tenantId: string | null, codeHash: string) =>
    `${tenantId ?? '__global__'}:${codeHash}`;

  const writer: SkillRegistryWriter = {
    async upsertSkill(record) {
      const k = key(record.tenantId, record.codeHash);
      if (rows.has(k)) return false;
      rows.set(k, record);
      return true;
    },
    async findByCodeHash(tenantId, codeHash) {
      return rows.get(key(tenantId, codeHash)) ?? null;
    },
  };

  return {
    writer,
    snapshot: () => Array.from(rows.values()),
  };
}
