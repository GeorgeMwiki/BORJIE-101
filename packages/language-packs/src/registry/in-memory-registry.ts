/**
 * In-memory language pack registry (UNIV-2).
 *
 * The canonical lookup surface for `LanguagePackDefinition` rows.
 * Hydrates from `SEED_PACK_DEFINITIONS` at construction; a database-
 * backed adapter implementing the same `LanguagePackDefinitionsRepository`
 * port can be swapped in without changing consumers.
 *
 * Lookups are O(1) for `id`, `bcp47`, `iso6391`. Status filter is
 * eager-built at construction so `listByStatus` is O(n_status) on
 * call.
 *
 * Returned arrays are frozen to preserve the immutability contract.
 */

import type { LanguagePackDefinition, LanguagePackDefinitionsRepository, PackStatus } from '../types.js';
import { LanguagePackError, languagePackDefinitionSchema } from '../types.js';
import { SEED_PACK_DEFINITIONS } from '../seed/seed-pack-definitions.js';
import { createLogger } from '../logger.js';
import type { Logger, TelemetryConfig } from '../logger.js';

export interface CreateInMemoryRegistryDeps {
  /** override the seed (e.g. for tests). Defaults to SEED_PACK_DEFINITIONS. */
  readonly definitions?: ReadonlyArray<LanguagePackDefinition>;
  /** telemetry config for the package-local logger */
  readonly telemetry?: TelemetryConfig;
  /** override the logger entirely (test injection) */
  readonly logger?: Logger;
}

interface RegistryIndices {
  readonly byId: ReadonlyMap<string, LanguagePackDefinition>;
  readonly byBcp47: ReadonlyMap<string, LanguagePackDefinition>;
  readonly byIso6391: ReadonlyMap<string, LanguagePackDefinition>;
  readonly byStatus: ReadonlyMap<PackStatus, ReadonlyArray<LanguagePackDefinition>>;
  readonly all: ReadonlyArray<LanguagePackDefinition>;
}

function buildIndices(
  defs: ReadonlyArray<LanguagePackDefinition>,
): RegistryIndices {
  const byId = new Map<string, LanguagePackDefinition>();
  const byBcp47 = new Map<string, LanguagePackDefinition>();
  const byIso6391 = new Map<string, LanguagePackDefinition>();
  const liveBucket: LanguagePackDefinition[] = [];
  const reservedBucket: LanguagePackDefinition[] = [];

  for (const def of defs) {
    // Schema-validate every definition at registry boot. This is the
    // single chokepoint that enforces the pack-shape contract.
    const parsed = languagePackDefinitionSchema.safeParse(def);
    if (!parsed.success) {
      throw new LanguagePackError(
        `invalid pack definition for id="${def.id}": ${parsed.error.message}`,
        'INVALID_INPUT',
      );
    }

    if (byId.has(def.id)) {
      throw new LanguagePackError(
        `duplicate pack id "${def.id}"`,
        'DUPLICATE_ID',
      );
    }
    if (byBcp47.has(def.bcp47)) {
      throw new LanguagePackError(
        `duplicate BCP-47 tag "${def.bcp47}"`,
        'DUPLICATE_ID',
      );
    }

    byId.set(def.id, def);
    byBcp47.set(def.bcp47, def);
    if (def.iso6391 !== null) {
      // Two different region-locked packs may share an ISO 639-1; we
      // index the first canonical (monolingual) pack. Region-locked
      // packs are resolved via bcp47 lookup.
      if (!byIso6391.has(def.iso6391)) {
        byIso6391.set(def.iso6391, def);
      }
    }

    if (def.status === 'live') {
      liveBucket.push(def);
    } else {
      reservedBucket.push(def);
    }
  }

  const byStatus = new Map<PackStatus, ReadonlyArray<LanguagePackDefinition>>();
  byStatus.set('live', Object.freeze(liveBucket.slice()));
  byStatus.set('reserved', Object.freeze(reservedBucket.slice()));

  return Object.freeze({
    byId,
    byBcp47,
    byIso6391,
    byStatus,
    all: Object.freeze(defs.slice()),
  }) as RegistryIndices;
}

export interface InMemoryLanguagePackRegistry
  extends LanguagePackDefinitionsRepository {
  /** Total pack count (live + reserved). */
  readonly count: () => number;
  /** Synchronous lookup variant for hot paths. */
  readonly findByIdSync: (id: string) => LanguagePackDefinition | null;
  /** Synchronous lookup by BCP-47 tag. */
  readonly findByBcp47Sync: (
    tag: string,
  ) => LanguagePackDefinition | null;
}

export function createInMemoryLanguagePackRegistry(
  deps: CreateInMemoryRegistryDeps = {},
): InMemoryLanguagePackRegistry {
  const defs = deps.definitions ?? SEED_PACK_DEFINITIONS;
  const indices = buildIndices(defs);
  const logger: Logger =
    deps.logger ??
    createLogger({
      config:
        deps.telemetry ?? {
          service: {
            name: '@borjie/language-packs',
            version: '0.1.0',
            environment: 'production',
          },
          level: 'info',
        },
    });

  logger.info('language-pack registry booted', {
    packCount: indices.all.length,
    liveCount: indices.byStatus.get('live')?.length ?? 0,
    reservedCount: indices.byStatus.get('reserved')?.length ?? 0,
  });

  function findByIdSync(id: string): LanguagePackDefinition | null {
    return indices.byId.get(id) ?? null;
  }

  function findByBcp47Sync(tag: string): LanguagePackDefinition | null {
    return indices.byBcp47.get(tag) ?? null;
  }

  return Object.freeze({
    count: (): number => indices.all.length,
    findByIdSync,
    findByBcp47Sync,
    listAll: async (): Promise<ReadonlyArray<LanguagePackDefinition>> =>
      indices.all,
    findById: async (id: string): Promise<LanguagePackDefinition | null> => {
      const hit = findByIdSync(id);
      if (hit === null) {
        logger.warn('pack lookup miss', { id, kind: 'id' });
      } else if (hit.status === 'reserved') {
        logger.warn('caller requested reserved pack', {
          id,
          fallbackHint: 'en',
        });
      }
      return hit;
    },
    findByBcp47: async (tag: string): Promise<LanguagePackDefinition | null> => {
      const hit = findByBcp47Sync(tag);
      if (hit === null) {
        logger.warn('pack lookup miss', { tag, kind: 'bcp47' });
      }
      return hit;
    },
    findByIso6391: async (
      code: string,
    ): Promise<LanguagePackDefinition | null> => {
      return indices.byIso6391.get(code) ?? null;
    },
    listByStatus: async (
      status: PackStatus,
    ): Promise<ReadonlyArray<LanguagePackDefinition>> => {
      return indices.byStatus.get(status) ?? Object.freeze([]);
    },
  });
}
