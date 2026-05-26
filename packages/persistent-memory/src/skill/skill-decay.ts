/**
 * Skill decay — transitions skills unused for ≥`SKILL_DECAY_DAYS`
 * days from canonical/tested → deprecated (Wave 18GG).
 *
 * Pure decider — no I/O. The consolidation worker invokes this nightly.
 */

import { SKILL_DECAY_DAYS, type Skill } from '../types.js';

export interface DecayDecision {
  readonly should_decay: boolean;
  readonly reason: 'never_used' | 'stale' | 'recent' | 'already_deprecated';
}

export function decideSkillDecay(skill: Skill, now: Date): DecayDecision {
  if (skill.status === 'deprecated') {
    return { should_decay: false, reason: 'already_deprecated' };
  }

  const cutoff = now.getTime() - SKILL_DECAY_DAYS * 24 * 60 * 60 * 1000;

  if (skill.last_used_at === null) {
    const createdMs = new Date(skill.created_at).getTime();
    if (createdMs < cutoff) {
      return { should_decay: true, reason: 'never_used' };
    }
    return { should_decay: false, reason: 'recent' };
  }

  const lastUsedMs = new Date(skill.last_used_at).getTime();
  if (lastUsedMs < cutoff) {
    return { should_decay: true, reason: 'stale' };
  }
  return { should_decay: false, reason: 'recent' };
}

/**
 * Produces the deprecated projection of a skill. Mutation discipline:
 * the registry inserts the new version; the old row is left in place
 * for audit.
 */
export function deprecateSkill(skill: Skill, now: Date): Skill {
  return {
    ...skill,
    version: skill.version + 1,
    status: 'deprecated',
    decayed_at: now.toISOString(),
  };
}
