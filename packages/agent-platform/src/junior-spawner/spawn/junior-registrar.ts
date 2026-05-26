/**
 * Junior registrar (Wave 18V-DYNAMIC).
 *
 * Converts a validated `SpawnedJuniorAuthorPayload` into a
 * `PersistedJuniorRecord` and writes it through the repository at
 * `lifecycle_status = 'draft'`. The first turn that uses the draft
 * promotes it to `shadow` (via `recordUsage` + lifecycle promotion).
 *
 * Pure orchestration — no LLM, no validation (validation happens in
 * `payload-validator.ts` upstream).
 */

import type { JuniorRepository } from '../storage/junior-repository.js';
import {
  MR_MWIKILA_DISPLAY_NAME,
  type PersistedJuniorRecord,
  type SpawnedJuniorAuthorPayload,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

export interface RegistrarInput {
  readonly payload: SpawnedJuniorAuthorPayload;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly source_turn_id: string;
  readonly now: Date;
}

// ─────────────────────────────────────────────────────────────────────
// Pure mapping from payload → record
// ─────────────────────────────────────────────────────────────────────

/**
 * Map the validated payload to a draft persisted record. Pure
 * function — no I/O. Useful for unit tests + admin-portal previews.
 */
export function buildDraftRecord(
  input: RegistrarInput,
): PersistedJuniorRecord {
  const { payload, tenant_id, user_id, source_turn_id } = input;
  return {
    id: payload.proposed_agent_id,
    display_name: MR_MWIKILA_DISPLAY_NAME,
    subtitle: payload.proposed_subtitle,
    specialisation: payload.proposed_specialisation,
    provenance: 'spawned',
    lifecycle_status: 'draft',
    scope: payload.proposed_scope,
    modes: payload.proposed_modes,
    escalation_policy: payload.proposed_escalation_policy,
    target_audiences: payload.proposed_audiences,
    authority_tier_max: payload.proposed_authority_tier_max,
    tenant_id,
    usage_count: 0,
    avg_satisfaction: null,
    last_used_at: null,
    spawned_by_user_id: user_id,
    spawned_from_turn_id: source_turn_id,
    promoted_at: null,
    locked_at: null,
    deprecated_at: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effecting registrar
// ─────────────────────────────────────────────────────────────────────

/**
 * Persist a draft record through the repository. Returns the record
 * for caller convenience (e.g. immediate turn-routing).
 */
export async function registerDraftJunior(
  input: RegistrarInput,
  repository: JuniorRepository,
): Promise<PersistedJuniorRecord> {
  const record = buildDraftRecord(input);
  await repository.insert(record);
  return record;
}
