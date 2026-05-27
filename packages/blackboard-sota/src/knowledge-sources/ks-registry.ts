/**
 * Knowledge-source registry — register, lookup, filter by region.
 *
 * Wave BLACKBOARD-CORE. Tiny domain service over a
 * `KnowledgeSourcesRepository`. Validates input with Zod, defaults
 * KS priority by `ksKind` per spec §3.2, and exposes a region-kind
 * filter used by the control shell.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.1, §5.
 */

import { z } from 'zod';
import {
  KS_KINDS,
  REGION_KINDS,
  BLACKBOARD_CONSTANTS,
  type KnowledgeSource,
  type KnowledgeSourcesRepository,
  type RegionKind,
  type RegisterKnowledgeSourceInput,
} from '../types.js';

const registerInputSchema = z.object({
  tenantId: z.string().min(1),
  ksKind: z.enum(KS_KINDS),
  ksName: z.string().min(1),
  regionFilter: z.array(z.enum(REGION_KINDS)).optional(),
  priority: z.number().min(0).max(1).optional(),
});

export interface KnowledgeSourceRegistry {
  register(input: RegisterKnowledgeSourceInput): Promise<KnowledgeSource>;
  listForRegion(
    tenantId: string,
    regionKind: RegionKind,
  ): Promise<ReadonlyArray<KnowledgeSource>>;
  getById(tenantId: string, id: string): Promise<KnowledgeSource | null>;
}

export function createKnowledgeSourceRegistry(deps: {
  readonly repository: KnowledgeSourcesRepository;
}): KnowledgeSourceRegistry {
  const { repository } = deps;

  return {
    async register(rawInput) {
      const input = registerInputSchema.parse(rawInput);
      const priority =
        input.priority ?? BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY[input.ksKind];
      const registerInput: RegisterKnowledgeSourceInput = {
        tenantId: input.tenantId,
        ksKind: input.ksKind,
        ksName: input.ksName,
        regionFilter: input.regionFilter ?? [],
        priority,
      };
      return repository.register(registerInput);
    },

    async listForRegion(tenantId, regionKind) {
      return repository.listForRegion(tenantId, regionKind);
    },

    async getById(tenantId, id) {
      return repository.getById(tenantId, id);
    },
  };
}
