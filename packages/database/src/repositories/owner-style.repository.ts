/**
 * Postgres OwnerStyleProfileStore — Drizzle adapter for the
 * `OwnerStyleProfileStore` port defined in
 * @borjie/ai-copilot/src/personas/owner-style/persistence-port.ts.
 *
 * The ai-copilot-side type is duck-typed locally so @borjie/database does not
 * depend on @borjie/ai-copilot. The shape is identical and a TypeScript
 * compatibility test in ai-copilot catches any drift.
 *
 * The rich profile (full Dirichlet posterior) round-trips through the
 * `profile_json` column. The typed dimension columns are a denormalised
 * projection of the headline category + per-dimension confidence, written on
 * every upsert so dashboards can sort/threshold without unpacking the JSON.
 *
 * Honest-degrade (CLAUDE.md): the caller treats a thrown error as "no profile
 * learned yet" — we never fabricate a profile here.
 */

import { eq } from 'drizzle-orm';
import { ownerStyleProfiles } from '../schemas/owner-style.schema.js';
import type { DatabaseClient } from '../client.js';

// ---------------------------------------------------------------------------
// Duck-typed shapes — keep in sync with the canonical types in ai-copilot.
// ---------------------------------------------------------------------------

interface StyleDimension<TValue extends string> {
  readonly value: TValue;
  readonly weights: Record<string, number>;
  readonly confidence: number;
}

export interface OwnerStyleProfile {
  readonly tenantId: string;
  readonly verbosity: StyleDimension<'terse' | 'balanced' | 'verbose'>;
  readonly detail: StyleDimension<'low' | 'medium' | 'high'>;
  readonly language: StyleDimension<
    'en' | 'en_leaning_bilingual' | 'sw_leaning_bilingual' | 'sw'
  >;
  readonly formality: StyleDimension<'formal' | 'neutral' | 'casual'>;
  readonly posture: StyleDimension<'cautious' | 'balanced' | 'bold'>;
  readonly lastUpdatedAt: string;
  readonly feedbackCount: number;
  readonly confidence: number;
  readonly updatedBySignal: string | null;
}

export interface OwnerStyleProfileStore {
  fetch(args: { readonly tenantId: string }): Promise<OwnerStyleProfile | null>;
  upsert(profile: OwnerStyleProfile): Promise<OwnerStyleProfile>;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Clamp a confidence value into a numeric(5,4) string for storage. */
function score(n: number): string {
  const clamped = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  return clamped.toFixed(4);
}

function mapToRow(profile: OwnerStyleProfile): Record<string, unknown> {
  return {
    tenantId: profile.tenantId,
    verbosity: profile.verbosity.value,
    detail: profile.detail.value,
    formality: profile.formality.value,
    posture: profile.posture.value,
    languagePreference: profile.language.value,
    verbosityScore: score(profile.verbosity.confidence),
    detailScore: score(profile.detail.confidence),
    formalityScore: score(profile.formality.confidence),
    postureScore: score(profile.posture.confidence),
    confidence: score(profile.confidence),
    feedbackCount: Math.max(0, Math.trunc(profile.feedbackCount)),
    updatedBySignal: profile.updatedBySignal,
    profileJson: profile,
    updatedAt: new Date(profile.lastUpdatedAt),
  };
}

function rowToProfile(
  r: typeof ownerStyleProfiles.$inferSelect
): OwnerStyleProfile | null {
  // The authoritative model is the round-tripped profile_json. The typed
  // columns are a projection; if the JSON is missing/malformed we cannot
  // honestly reconstruct the Dirichlet weights, so return null rather than
  // fabricate them.
  const json = r.profileJson;
  if (json && typeof json === 'object' && 'verbosity' in json) {
    return json as unknown as OwnerStyleProfile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPgOwnerStyleProfileStore(
  db: DatabaseClient
): OwnerStyleProfileStore {
  return {
    async fetch({ tenantId }) {
      const rows = await db
        .select()
        .from(ownerStyleProfiles)
        .where(eq(ownerStyleProfiles.tenantId, tenantId))
        .limit(1);
      const r = rows[0];
      return r ? rowToProfile(r) : null;
    },

    async upsert(profile) {
      const row = mapToRow(profile);
      await db
        .insert(ownerStyleProfiles)
        .values(row as never)
        .onConflictDoUpdate({
          target: ownerStyleProfiles.tenantId,
          set: {
            verbosity: row.verbosity,
            detail: row.detail,
            formality: row.formality,
            posture: row.posture,
            languagePreference: row.languagePreference,
            verbosityScore: row.verbosityScore,
            detailScore: row.detailScore,
            formalityScore: row.formalityScore,
            postureScore: row.postureScore,
            confidence: row.confidence,
            feedbackCount: row.feedbackCount,
            updatedBySignal: row.updatedBySignal,
            profileJson: row.profileJson,
            updatedAt: row.updatedAt,
          } as never,
        });
      // Echo back the validated input we just persisted.
      return profile;
    },
  };
}
