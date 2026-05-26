/**
 * In-memory reference implementation of `SkillRepository` (Wave 18GG).
 * Production wires a Postgres-backed adapter; this module exists for
 * tests and ephemeral worker contexts.
 */

import type { Skill, SkillRepository } from '../types.js';

export function createInMemorySkillRepository(): SkillRepository {
  const skills = new Map<string, Skill>();

  const key = (id: string, version: number): string => `${id}::${version}`;

  return {
    async insert(s) {
      skills.set(key(s.id, s.version), s);
    },
    async findByIntent(tenant_id, intent) {
      const matches: Skill[] = [];
      for (const s of skills.values()) {
        if (s.tenant_id === tenant_id && s.intent === intent) {
          matches.push(s);
        }
      }
      return matches.sort((a, b) => b.version - a.version);
    },
    async findById(id, version) {
      return skills.get(key(id, version)) ?? null;
    },
    async listForDecayScan(tenant_id, older_than) {
      const cutoff = older_than.getTime();
      const matches: Skill[] = [];
      for (const s of skills.values()) {
        if (s.tenant_id !== tenant_id) continue;
        if (s.status === 'deprecated') continue;
        const lastUsed = s.last_used_at
          ? new Date(s.last_used_at).getTime()
          : new Date(s.created_at).getTime();
        if (lastUsed < cutoff) {
          matches.push(s);
        }
      }
      return matches;
    },
  };
}
