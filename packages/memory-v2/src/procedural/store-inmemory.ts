/**
 * Procedural skill store — Voyager-style promotion (W4.x pattern).
 *
 * Each time we observe a (trigger → action sequence) we increment its
 * count. When `observedCount >= PROMOTION_THRESHOLD`, the skill is
 * marked `promoted` and surfaces in `getPromotedSkills()`.
 *
 * `recordSkill` accepts a partially-shaped skill — observedCount /
 * successRate are merged with the existing row if one exists.
 */

import type {
  ProceduralSkill,
  ProceduralStore,
  TenantId,
} from '../types.js';

const PROMOTION_THRESHOLD = 3;

export function createInMemoryProceduralStore(): ProceduralStore {
  const skills = new Map<string, ProceduralSkill>();

  return {
    async recordSkill(skill: ProceduralSkill): Promise<ProceduralSkill> {
      const key = `${skill.tenantId}:${skill.name}`;
      const existing = skills.get(key);
      if (existing) {
        const observedCount = existing.observedCount + 1;
        const successRate = blendSuccessRate(
          existing.successRate,
          existing.observedCount,
          skill.successRate,
        );
        const merged: ProceduralSkill = {
          ...existing,
          observedCount,
          successRate,
          promoted: observedCount >= PROMOTION_THRESHOLD,
          lastSeenAt: skill.lastSeenAt,
          actionSequence: skill.actionSequence,
          triggerPattern: skill.triggerPattern,
          description: skill.description,
        };
        skills.set(key, merged);
        return merged;
      }
      const inserted: ProceduralSkill = {
        ...skill,
        observedCount: Math.max(1, skill.observedCount),
        promoted:
          Math.max(1, skill.observedCount) >= PROMOTION_THRESHOLD,
      };
      skills.set(key, inserted);
      return inserted;
    },

    async getPromotedSkills(
      tenantId: TenantId,
      limit = 25,
    ): Promise<ReadonlyArray<ProceduralSkill>> {
      return Array.from(skills.values())
        .filter((s) => s.tenantId === tenantId && s.promoted)
        .sort(
          (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
        )
        .slice(0, limit);
    },

    async findByName(
      tenantId: TenantId,
      name: string,
    ): Promise<ProceduralSkill | null> {
      return skills.get(`${tenantId}:${name}`) ?? null;
    },
  };
}

function blendSuccessRate(
  prevRate: number,
  prevCount: number,
  newSample: number,
): number {
  const weighted =
    (prevRate * prevCount + newSample) / (prevCount + 1);
  return Math.max(0, Math.min(1, weighted));
}

export const PROCEDURAL_PROMOTION_THRESHOLD = PROMOTION_THRESHOLD;
