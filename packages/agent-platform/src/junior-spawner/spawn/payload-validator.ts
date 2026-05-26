/**
 * Validator for `SpawnedJuniorAuthorPayload` (Wave 18V-DYNAMIC).
 *
 * The spawning LLM emits a JSON object; this validator enforces the
 * `JuniorPersona` contract from `junior-contract.ts` so the database
 * row insert can never see a malformed shape. Zod is the validation
 * library used elsewhere in the repo.
 *
 * The validator is intentionally strict:
 *   - agent_id must be kebab-case
 *   - subtitle must start with "Borjie's AI"
 *   - at least one mode is required
 *   - target_audiences must be non-empty and from the canonical set
 *   - authority_tier_max in {0, 1, 2}
 */

import type { SpawnedJuniorAuthorPayload } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { readonly ok: true; readonly payload: SpawnedJuniorAuthorPayload }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

// ─────────────────────────────────────────────────────────────────────
// Patterns + constants
// ─────────────────────────────────────────────────────────────────────

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SUBTITLE_PREFIX = "Borjie's AI";
const VALID_AUDIENCES = new Set([
  'owner',
  'admin',
  'manager',
  'employee',
  'customer',
  'regulator',
]);
const VALID_TIER = new Set([0, 1, 2]);
const MIN_MODES = 1;

// ─────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a candidate payload against the JuniorPersona contract.
 * Returns a discriminated union so callers can branch without
 * try/catch.
 */
export function validateSpawnedJuniorPayload(
  candidate: unknown,
): ValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: ['payload must be an object'] };
  }
  const c = candidate as Record<string, unknown>;

  if (typeof c['proposed_agent_id'] !== 'string') {
    errors.push('proposed_agent_id must be a string');
  } else if (!KEBAB_CASE.test(c['proposed_agent_id'])) {
    errors.push('proposed_agent_id must be kebab-case');
  }

  if (typeof c['proposed_specialisation'] !== 'string' || c['proposed_specialisation'].length === 0) {
    errors.push('proposed_specialisation must be a non-empty string');
  }

  if (typeof c['proposed_subtitle'] !== 'string') {
    errors.push('proposed_subtitle must be a string');
  } else if (!c['proposed_subtitle'].startsWith(SUBTITLE_PREFIX)) {
    errors.push(`proposed_subtitle must start with "${SUBTITLE_PREFIX}"`);
  }

  if (!Array.isArray(c['proposed_modes']) || c['proposed_modes'].length < MIN_MODES) {
    errors.push(`proposed_modes must include at least ${MIN_MODES} mode`);
  }

  if (!Array.isArray(c['proposed_audiences']) || c['proposed_audiences'].length === 0) {
    errors.push('proposed_audiences must be a non-empty array');
  } else {
    for (const aud of c['proposed_audiences']) {
      if (typeof aud !== 'string' || !VALID_AUDIENCES.has(aud)) {
        errors.push(`audience '${String(aud)}' is not a canonical Audience`);
      }
    }
  }

  if (
    typeof c['proposed_authority_tier_max'] !== 'number' ||
    !VALID_TIER.has(c['proposed_authority_tier_max'] as number)
  ) {
    errors.push('proposed_authority_tier_max must be 0, 1, or 2');
  }

  if (typeof c['proposed_scope'] !== 'object' || c['proposed_scope'] === null) {
    errors.push('proposed_scope must be a JuniorScope object');
  }

  if (typeof c['proposed_escalation_policy'] !== 'object' || c['proposed_escalation_policy'] === null) {
    errors.push('proposed_escalation_policy must be an EscalationPolicy object');
  }

  if (typeof c['llm_reasoning'] !== 'string' || c['llm_reasoning'].length === 0) {
    errors.push('llm_reasoning must be a non-empty string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, payload: candidate as SpawnedJuniorAuthorPayload };
}
