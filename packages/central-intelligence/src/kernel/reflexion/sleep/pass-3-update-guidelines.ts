/**
 * Sleep Pass 3 — update the kernel's persistent guidelines doc.
 *
 * Consumes the candidate patterns from pass-2 and writes them to
 * `reflexion_guidelines`. Dedupe is by `slug` (lower-cased
 * `${trigger} ${action}` FNV-1a hash). Conflict resolution:
 *
 *   - SLUG NOT EXISTS → INSERT.
 *   - SLUG EXISTS + new confidence >= existing → OVERWRITE body,
 *     refresh updated_at, merge sourceReflexionIds.
 *   - SLUG EXISTS + new confidence  < existing → append the new source
 *     reflexion ids only (the existing body wins).
 *
 * Pure orchestration; the port owns the actual upsert.
 */

import type { CandidatePattern } from './pass-2-extract-patterns.js';

export interface UpdateGuidelinesPort {
  loadBySlug(args: {
    readonly tenantId: string;
    readonly slug: string;
  }): Promise<{
    readonly id: string;
    readonly body: string;
    readonly confidence: number;
    readonly sourceReflexionIds: ReadonlyArray<string>;
  } | null>;
  insert(args: {
    readonly tenantId: string;
    readonly userId: string | null;
    readonly slug: string;
    readonly body: string;
    readonly confidence: number;
    readonly sourceReflexionIds: ReadonlyArray<string>;
  }): Promise<{ id: string }>;
  update(args: {
    readonly id: string;
    readonly body?: string;
    readonly confidence?: number;
    readonly sourceReflexionIds: ReadonlyArray<string>;
  }): Promise<void>;
}

export interface UpdateGuidelinesArgs {
  readonly tenantId: string;
  readonly candidates: ReadonlyArray<CandidatePattern>;
  /** Per-cluster minimum confidence to write. Default 0.4. */
  readonly minConfidence?: number;
  /**
   * When NULL, every candidate is written tenant-wide. When set, the
   * pass writes user-scoped guidelines (used by the orchestrator when
   * the source cluster is single-user dominant).
   */
  readonly userId?: string | null;
}

export interface UpdateGuidelinesReport {
  readonly tenantId: string;
  readonly inserted: number;
  readonly overwritten: number;
  readonly appendedSourcesOnly: number;
  readonly skippedBelowConfidence: number;
  readonly errors: number;
  readonly notes: string;
}

const DEFAULT_MIN_CONFIDENCE = 0.4;

export async function runUpdateGuidelinesPass(
  port: UpdateGuidelinesPort,
  args: UpdateGuidelinesArgs,
): Promise<UpdateGuidelinesReport> {
  const tenantId = args.tenantId;
  if (!tenantId) {
    return Object.freeze({
      tenantId,
      inserted: 0,
      overwritten: 0,
      appendedSourcesOnly: 0,
      skippedBelowConfidence: 0,
      errors: 0,
      notes: 'skipped: invalid args',
    });
  }
  const minConfidence = clamp01(args.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  const userId = args.userId ?? null;

  let inserted = 0;
  let overwritten = 0;
  let appendedSourcesOnly = 0;
  let skippedBelowConfidence = 0;
  let errors = 0;

  for (const candidate of args.candidates) {
    if (candidate.confidence < minConfidence) {
      skippedBelowConfidence += 1;
      continue;
    }
    const body = composeBody(candidate);
    try {
      const existing = await port.loadBySlug({
        tenantId,
        slug: candidate.slug,
      });
      if (!existing) {
        await port.insert({
          tenantId,
          userId,
          slug: candidate.slug,
          body,
          confidence: candidate.confidence,
          sourceReflexionIds: candidate.sourceReflexionIds,
        });
        inserted += 1;
        continue;
      }
      const merged = mergeSourceIds(
        existing.sourceReflexionIds,
        candidate.sourceReflexionIds,
      );
      if (candidate.confidence >= existing.confidence) {
        await port.update({
          id: existing.id,
          body,
          confidence: candidate.confidence,
          sourceReflexionIds: merged,
        });
        overwritten += 1;
      } else {
        await port.update({
          id: existing.id,
          sourceReflexionIds: merged,
        });
        appendedSourcesOnly += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return Object.freeze({
    tenantId,
    inserted,
    overwritten,
    appendedSourcesOnly,
    skippedBelowConfidence,
    errors,
    notes: `+${inserted} inserted, ${overwritten} overwritten, ${appendedSourcesOnly} source-only, ${skippedBelowConfidence} below-confidence, ${errors} error(s)`,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests).
// ─────────────────────────────────────────────────────────────────────

export function composeBody(candidate: CandidatePattern): string {
  const trigger = (candidate.trigger ?? '').trim();
  const action = (candidate.suggestedAction ?? '').trim();
  if (!trigger || !action) return trigger || action || '';
  const body = `When ${trigger.replace(/\.$/, '').toLowerCase()}, ${action.replace(/\.$/, '')}.`;
  return body.slice(0, 600);
}

export function mergeSourceIds(
  existing: ReadonlyArray<string>,
  incoming: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const set = new Set<string>();
  for (const id of existing) if (id) set.add(id);
  for (const id of incoming) if (id) set.add(id);
  return Array.from(set).slice(0, 50);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
