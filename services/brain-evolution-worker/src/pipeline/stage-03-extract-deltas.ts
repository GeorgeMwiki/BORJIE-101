/**
 * Stage 03 — extract memory deltas from a reflection.
 *
 * Pattern: classify each insight in the reflection into a target memory
 * block (core / semantic / embedded), then emit a `MemoryDelta` with a
 * deterministic `idempotencyKey`. The idempotency key is a content hash
 * over (tenantId, blockKind, target, content) so re-running the same
 * day's reflection writes nothing new — that's the worker's idempotency
 * contract.
 *
 * Heuristic mapping (extractor port can override):
 *   - `worked` insights about tone / preference -> core/preferences delta
 *   - `failed` insights about workflow -> semantic delta (key=workflow-fail)
 *   - `novel` patterns -> semantic delta (key=novel-pattern)
 *   - persona-level skills (per-persona scope) -> core/persona delta
 *
 * The default extractor uses these mappings; tests can swap it for a
 * deterministic fixture extractor.
 *
 * Each delta carries an `actionTag` the constitution verifier matches
 * against (see review-gate). Default action tag for memory writes is
 * `memory.delta.apply` — the v1 constitution treats this as a low-risk
 * write that should still pass through the citation gate.
 */

import { createHash } from 'crypto';

import type {
  MemoryDelta,
  ReflectionResult,
  CoreBlockSubKind,
} from '../types.js';

/**
 * Pluggable extractor — composition root can swap in an LLM-backed
 * extractor that produces richer deltas. Default extractor below is
 * deterministic and runs in <1ms on a typical day.
 */
export interface DeltaExtractor {
  extract(reflection: ReflectionResult): ReadonlyArray<DraftDelta>;
}

/**
 * Pre-keyed delta the extractor emits. `idempotencyKey` is computed by
 * the stage runner so extractors don't have to know the hash discipline.
 */
export interface DraftDelta {
  readonly blockKind: MemoryDelta['blockKind'];
  readonly coreSubKind: CoreBlockSubKind | null;
  readonly userId: string | null;
  readonly personaId: string | null;
  readonly semanticKey: string | null;
  readonly actionTag: string;
  readonly content: string;
  readonly confidence: number;
  readonly rationale: string;
}

const DEFAULT_ACTION_TAG = 'memory.delta.apply';
const PERSONA_ACTION_TAG = 'memory.persona.refine';
const SYSTEM_ACTION_TAG = 'memory.system.refine';

/**
 * Default heuristic extractor. Returns at most a handful of deltas per
 * reflection — the goal is to keep nightly memory churn bounded.
 *
 * Confidence is taken from the reflection's agreement score for `worked`
 * + `novel` insights (the jury liked these) and dampened by 0.5 for
 * `failed` insights (less certain how to encode the failure as a memory
 * change).
 */
export function createDefaultExtractor(): DeltaExtractor {
  return {
    extract(reflection) {
      const drafts: DraftDelta[] = [];
      const baseConfidence = Math.max(reflection.agreement, 0.4);

      for (const insight of reflection.worked) {
        drafts.push({
          blockKind: 'core',
          coreSubKind: 'preferences',
          userId: null,
          personaId: null,
          semanticKey: null,
          actionTag: DEFAULT_ACTION_TAG,
          content: insight,
          confidence: baseConfidence,
          rationale: 'Worked-pattern insight from sleep-time reflection.',
        });
      }

      for (const insight of reflection.failed) {
        drafts.push({
          blockKind: 'semantic',
          coreSubKind: null,
          userId: null,
          personaId: null,
          semanticKey: 'workflow-fail',
          actionTag: SYSTEM_ACTION_TAG,
          content: insight,
          confidence: baseConfidence * 0.5,
          rationale: 'Failed-pattern insight from sleep-time reflection.',
        });
      }

      for (const insight of reflection.novel) {
        drafts.push({
          blockKind: 'semantic',
          coreSubKind: null,
          userId: null,
          personaId: null,
          semanticKey: 'novel-pattern',
          actionTag: PERSONA_ACTION_TAG,
          content: insight,
          confidence: baseConfidence,
          rationale: 'Novel pattern discovered during sleep-time reflection.',
        });
      }

      return drafts;
    },
  };
}

export interface ExtractDeltasArgs {
  readonly reflection: ReflectionResult;
  readonly extractor?: DeltaExtractor;
  /** Cap on deltas per reflection. Defaults to 50. */
  readonly maxDeltas?: number;
}

const DEFAULT_MAX_DELTAS = 50;

/**
 * Run stage 03. Pure function over the extractor. Computes
 * idempotency keys deterministically — the same draft from the same
 * reflection produces the same key.
 */
export function extractDeltas(args: ExtractDeltasArgs): ReadonlyArray<MemoryDelta> {
  const extractor = args.extractor ?? createDefaultExtractor();
  const maxDeltas = clampPositiveInt(args.maxDeltas, DEFAULT_MAX_DELTAS);
  const drafts = extractor.extract(args.reflection);

  const capped = drafts.slice(0, maxDeltas);

  return capped.map((draft) =>
    finaliseDelta(args.reflection.tenantId, draft),
  );
}

function finaliseDelta(
  tenantId: string,
  draft: DraftDelta,
): MemoryDelta {
  const idempotencyKey = computeIdempotencyKey(tenantId, draft);
  return {
    idempotencyKey,
    tenantId,
    blockKind: draft.blockKind,
    coreSubKind: draft.coreSubKind,
    userId: draft.userId,
    personaId: draft.personaId,
    semanticKey: draft.semanticKey,
    actionTag: draft.actionTag,
    content: draft.content,
    confidence: clamp01(draft.confidence),
    rationale: draft.rationale,
  };
}

/**
 * Deterministic content hash. The pipeline relies on this being stable
 * across runs: any change to the inputs produces a new key, but the same
 * inputs always produce the same key.
 */
export function computeIdempotencyKey(
  tenantId: string,
  draft: DraftDelta,
): string {
  const canonical = JSON.stringify({
    t: tenantId,
    k: draft.blockKind,
    s: draft.coreSubKind,
    u: draft.userId,
    p: draft.personaId,
    sk: draft.semanticKey,
    c: draft.content,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampPositiveInt(
  candidate: number | undefined,
  fallback: number,
): number {
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate <= 0
  ) {
    return fallback;
  }
  return Math.min(Math.floor(candidate), 1000);
}
