/**
 * Junior selection orchestrator (Wave 18V-DYNAMIC).
 *
 * Implements the 8-step algorithm in `JUNIOR_DYNAMIC_SPAWNING_SPEC.md`
 * §5. Pure orchestration over the matchers + the repository; the
 * caller wires the LLM-spawn path separately so this function is
 * easy to test deterministically.
 */

import { findSeedMatch } from './seed-matcher.js';
import { findSpawnedMatch } from './spawned-matcher.js';
import { findTenantAuthoredMatch } from './tenant-authored-matcher.js';
import type { JuniorRepository } from '../storage/junior-repository.js';
import {
  SELECTION_MATCH_THRESHOLD,
  type JuniorSpawnRequest,
  type SpawnDecision,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Dependency bundle
// ─────────────────────────────────────────────────────────────────────

export interface SelectJuniorDeps {
  readonly repository: JuniorRepository;
}

// ─────────────────────────────────────────────────────────────────────
// Algorithm
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the 8-step selection algorithm. Returns a `SpawnDecision`
 * tagged with the provenance class that won; callers handle the
 * `spawn_new` branch by invoking the LLM-spawn path.
 *
 * Score cutoff is the constant `SELECTION_MATCH_THRESHOLD` (0.85).
 */
export async function selectJunior(
  request: JuniorSpawnRequest,
  deps: SelectJuniorDeps,
): Promise<SpawnDecision> {
  const pool = await deps.repository.listVisibleForTenant(request.tenant_id);
  const intent_keywords = request.active_scope.intent_keywords;
  const audience = request.active_scope.audience;

  // Step 2-3: seed
  const seed = findSeedMatch(pool, intent_keywords, audience);
  if (seed.junior && seed.score >= SELECTION_MATCH_THRESHOLD) {
    return {
      kind: 'use_seed',
      junior_id: seed.junior.id,
      specialisation: seed.junior.specialisation,
      subtitle: seed.junior.subtitle,
      reasoning: `Matched seed junior on intent keywords (score ${seed.score.toFixed(2)}).`,
      confidence: seed.score,
    };
  }

  // Step 4-5: tenant-authored
  const tenant = findTenantAuthoredMatch(
    pool,
    intent_keywords,
    audience,
    request.tenant_id,
  );
  if (tenant.junior && tenant.score >= SELECTION_MATCH_THRESHOLD) {
    return {
      kind: 'use_tenant_authored',
      junior_id: tenant.junior.id,
      specialisation: tenant.junior.specialisation,
      subtitle: tenant.junior.subtitle,
      reasoning: `Matched tenant-authored junior (score ${tenant.score.toFixed(2)}).`,
      confidence: tenant.score,
    };
  }

  // Step 6-7: previously-spawned
  const spawned = findSpawnedMatch(
    pool,
    intent_keywords,
    audience,
    request.tenant_id,
  );
  if (spawned.junior && spawned.score >= SELECTION_MATCH_THRESHOLD) {
    return {
      kind: 'use_spawned',
      junior_id: spawned.junior.id,
      specialisation: spawned.junior.specialisation,
      subtitle: spawned.junior.subtitle,
      reasoning: `Matched previously-spawned junior (score ${spawned.score.toFixed(2)}).`,
      confidence: spawned.score,
    };
  }

  // Step 8: spawn new
  const best_existing = bestOf(seed.score, tenant.score, spawned.score);
  return {
    kind: 'spawn_new',
    junior_id: '',
    specialisation: '',
    subtitle: '',
    reasoning: `No existing junior matched at threshold ${SELECTION_MATCH_THRESHOLD}. Best score was ${best_existing.toFixed(2)}. Authoring new specialist.`,
    confidence: 0,
  };
}

function bestOf(a: number, b: number, c: number): number {
  return Math.max(a, b, c);
}
