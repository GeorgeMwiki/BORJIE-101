/**
 * Skill registry — write + lookup surface for the procedural memory
 * tier (Wave 18GG).
 *
 * Skills are versioned by `(id, version)`. The registry is append-
 * only — promotion / decay produce a NEW row with the next version
 * number. This mirrors the immutable lifecycle the cognitive-memory
 * package uses for cells.
 */

import {
  PersistentMemoryError,
  skillSchema,
  type AuditChainPort,
  type Skill,
  type SkillRepository,
} from '../types.js';

export interface SkillRegistryDeps {
  readonly repo: SkillRepository;
  readonly audit: AuditChainPort;
}

export interface SkillObserveInput {
  readonly id: string;
  readonly tenant_id: string;
  readonly scope_id: string;
  readonly intent: string;
  readonly preconditions: Skill['preconditions'];
  readonly steps: Skill['steps'];
  readonly postconditions: Skill['postconditions'];
  readonly success_rate: number;
  readonly invocations: number;
  readonly composed_from_skills: ReadonlyArray<string>;
  readonly now: Date;
}

export type SkillObserveFn = (input: SkillObserveInput) => Promise<Skill>;

export function createSkillObserve(deps: SkillRegistryDeps): SkillObserveFn {
  return async (input) => {
    if (input.success_rate < 0 || input.success_rate > 1) {
      throw new PersistentMemoryError(
        'success_rate must be within [0,1]',
        'INVALID_INPUT',
      );
    }
    if (input.invocations < 0) {
      throw new PersistentMemoryError(
        'invocations must be non-negative',
        'INVALID_INPUT',
      );
    }

    const candidateNoHash: Omit<Skill, 'audit_hash'> = {
      id: input.id,
      version: 1,
      tenant_id: input.tenant_id,
      scope_id: input.scope_id,
      intent: input.intent,
      preconditions: input.preconditions,
      steps: input.steps,
      postconditions: input.postconditions,
      success_rate: input.success_rate,
      invocations: input.invocations,
      last_used_at: null,
      composed_from_skills: input.composed_from_skills,
      status: 'observed',
      decayed_at: null,
      created_at: input.now.toISOString(),
    };

    const auditHash = await deps.audit.append({
      tenant_id: input.tenant_id,
      event_kind: 'skill.observe',
      entity_id: `${input.id}::1`,
      recorded_at: input.now.toISOString(),
      payload_digest: `skl_${input.id}_v1`,
    });

    const candidate: Skill = { ...candidateNoHash, audit_hash: auditHash };

    // Defensive: validate the row against our public schema before
    // persisting so malformed inputs never reach the repository.
    skillSchema.parse(candidate);

    await deps.repo.insert(candidate);
    return candidate;
  };
}

export interface SkillLookupDeps {
  readonly repo: SkillRepository;
}

export type SkillLookupByIntentFn = (
  tenant_id: string,
  intent: string,
) => Promise<ReadonlyArray<Skill>>;

export function createSkillLookupByIntent(
  deps: SkillLookupDeps,
): SkillLookupByIntentFn {
  return async (tenant_id, intent) => {
    const matches = await deps.repo.findByIntent(tenant_id, intent);
    // Surface only non-deprecated skills to the recall path.
    return matches.filter((s) => s.status !== 'deprecated');
  };
}
