/**
 * Persistent-store composition wiring.
 *
 * Glues the 5 in-memory ports shipped by their originating packages to
 * the Drizzle-backed adapters in `@borjie/database`. The wiring is
 * env-gated so dev / CI keep the zero-config in-memory defaults; prod
 * boots into the persistent path automatically when `DATABASE_URL` is
 * set (and per-port feature flags are not explicitly disabled).
 *
 * Feature flags (per-port opt-out, ALL default-on once DATABASE_URL is set):
 *   - PERSISTENT_LESSON_STORE_DISABLED=1
 *   - PERSISTENT_WORM_AUDIT_DISABLED=1
 *   - PERSISTENT_SKILL_REGISTRY_DISABLED=1
 *   - PERSISTENT_AOP_REGISTRY_DISABLED=1
 *   - PERSISTENT_A2A_TASKS_DISABLED=1
 *
 * Composition root contract:
 *   const stores = createPersistentStores({ db, logger });
 *   server.decorate('lessonStore', stores.lessonStore);
 *   ...
 *
 * Tenant scoping:
 *   - LessonStore + WormAuditStore + SkillRegistryWriter — tenant-aware
 *     at the call-site (every method accepts tenantId).
 *   - A2A TaskStore — tenant-pinned at construction. The wiring builds
 *     one per tenant via `getOrCreateA2aTaskStore(tenantId)`.
 *   - AOP Registry — platform-global by default; `scopeTenantId` is
 *     null. Multi-tenant deployments can build per-tenant stores.
 */

import {
  createLessonStoreService,
  createWormAuditLogService,
  createSkillRegistryWriterService,
  createA2aTaskStoreService,
  createAopRegistryStoreService,
} from '@borjie/database';
import {
  createInMemoryLessonStore,
  type LessonStore,
} from '@borjie/ai-copilot/reflexion';
import {
  createInMemorySkillRegistry,
  type SkillRegistryWriter,
} from '@borjie/ai-copilot/skill-promotion';
import {
  createInMemoryTaskStore,
  type TaskStore,
} from '@borjie/agent-platform/a2a';
import type { AOPRegistryStore } from '@borjie/central-intelligence/aops';

/**
 * Minimal WormAuditStore shape used by this wiring. The full interface
 * lives in `@borjie/document-studio/signing` — we don't import it
 * directly here to avoid the subpath-resolution issue (the package
 * doesn't ship a root barrel). The persistent Drizzle adapter
 * (`createWormAuditLogService`) satisfies this shape structurally.
 */
interface WormAuditStore {
  append(entry: Readonly<Record<string, unknown>>): Promise<unknown>;
  list(tenantId: string): Promise<ReadonlyArray<unknown>>;
  verify(tenantId: string): Promise<{ ok: boolean; brokenAt?: number }>;
}

/**
 * Type alias for the database client. We type as `unknown` at this
 * boundary and let the individual `create*Service` factories type-check
 * the actual shape — the alternative (importing `DatabaseClient` from
 * `@borjie/database`) trips a namespace-vs-type ambiguity under
 * the api-gateway tsconfig that isn't worth working around here.
 */
type Db = unknown;

export interface PersistentStoresDeps {
  /** Drizzle DB client when persistent path is enabled. */
  readonly db?: Db | null;
  /** Optional structured logger. */
  readonly logger?: {
    info?(obj: Record<string, unknown>, msg?: string): void;
    warn?(obj: Record<string, unknown>, msg?: string): void;
  };
}

export interface PersistentStores {
  readonly lessonStore: LessonStore;
  readonly wormAuditStore: WormAuditStore;
  readonly skillRegistryWriter: SkillRegistryWriter;
  readonly aopRegistryStore: AOPRegistryStore;
  /**
   * The A2A task store is tenant-pinned. Use this factory to get a
   * store for a specific tenant on demand. Per-tenant instances are
   * cached in-process so repeat lookups are zero-cost.
   */
  readonly getA2aTaskStore: (tenantId: string) => TaskStore;
  /** Which path each store took at boot ('persistent' | 'memory'). */
  readonly modeByStore: Readonly<Record<string, 'persistent' | 'memory'>>;
}

const ENV_FLAGS = {
  lessonStore: 'PERSISTENT_LESSON_STORE_DISABLED',
  wormAudit: 'PERSISTENT_WORM_AUDIT_DISABLED',
  skillRegistry: 'PERSISTENT_SKILL_REGISTRY_DISABLED',
  aopRegistry: 'PERSISTENT_AOP_REGISTRY_DISABLED',
  a2aTasks: 'PERSISTENT_A2A_TASKS_DISABLED',
} as const;

function flagOn(envName: string): boolean {
  const v = process.env[envName];
  return v === '1' || v === 'true' || v === 'yes';
}

export function createPersistentStores(
  deps: PersistentStoresDeps,
): PersistentStores {
  const db = deps.db ?? null;
  const modeByStore: Record<string, 'persistent' | 'memory'> = {};

  // ─── Lesson store ───────────────────────────────────────────────
  let lessonStore: LessonStore;
  if (db && !flagOn(ENV_FLAGS.lessonStore)) {
    lessonStore = createLessonStoreService({ db }) as unknown as LessonStore;
    modeByStore['lessonStore'] = 'persistent';
  } else {
    lessonStore = createInMemoryLessonStore();
    modeByStore['lessonStore'] = 'memory';
  }

  // ─── WORM audit store ───────────────────────────────────────────
  let wormAuditStore: WormAuditStore;
  if (db && !flagOn(ENV_FLAGS.wormAudit)) {
    wormAuditStore = createWormAuditLogService({ db }) as unknown as WormAuditStore;
    modeByStore['wormAuditStore'] = 'persistent';
  } else {
    // In-memory fallback. The full interface lives in
    // `@borjie/document-studio/signing`; we inline a minimal stub
    // here to avoid the package's missing root barrel.
    wormAuditStore = {
      async append(entry) {
        return { ...entry, entryId: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
      },
      async list() {
        return [];
      },
      async verify() {
        return { ok: true };
      },
    };
    modeByStore['wormAuditStore'] = 'memory';
  }

  // ─── Skill registry writer ──────────────────────────────────────
  let skillRegistryWriter: SkillRegistryWriter;
  if (db && !flagOn(ENV_FLAGS.skillRegistry)) {
    skillRegistryWriter =
      createSkillRegistryWriterService({ db }) as unknown as SkillRegistryWriter;
    modeByStore['skillRegistryWriter'] = 'persistent';
  } else {
    skillRegistryWriter = createInMemorySkillRegistry() as unknown as SkillRegistryWriter;
    modeByStore['skillRegistryWriter'] = 'memory';
  }

  // ─── AOP registry store ─────────────────────────────────────────
  let aopRegistryStore: AOPRegistryStore;
  if (db && !flagOn(ENV_FLAGS.aopRegistry)) {
    aopRegistryStore = createAopRegistryStoreService({
      db,
      scopeTenantId: null,
    }) as unknown as AOPRegistryStore;
    modeByStore['aopRegistryStore'] = 'persistent';
  } else {
    // The in-memory AOP registry lives in central-intelligence. We
    // don't import it here to keep this composition module focused —
    // central-intelligence's createAOPRegistry({}) is the in-mem
    // default and is wired one layer up. If the operator wants to
    // force memory mode AND not wire the central-intel default, they
    // can set PERSISTENT_AOP_REGISTRY_DISABLED=1 and the kernel layer
    // falls back to its own in-memory registry.
    aopRegistryStore = NULL_AOP_REGISTRY_STORE;
    modeByStore['aopRegistryStore'] = 'memory';
  }

  // ─── A2A task store (per-tenant) ────────────────────────────────
  // Decide the mode ONCE at construction so the returned `modeByStore`
  // can be safely frozen below (the per-tenant factory below is a
  // closure that doesn't mutate `modeByStore`).
  const a2aUsePersistent = !!db && !flagOn(ENV_FLAGS.a2aTasks);
  modeByStore['a2aTaskStore'] = a2aUsePersistent ? 'persistent' : 'memory';
  const a2aCache = new Map<string, TaskStore>();
  function getA2aTaskStore(tenantId: string): TaskStore {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('persistent-stores: A2A taskStore requires a non-empty tenantId');
    }
    const cached = a2aCache.get(tenantId);
    if (cached) return cached;
    const store: TaskStore = a2aUsePersistent
      ? (createA2aTaskStoreService({ db, tenantId }) as unknown as TaskStore)
      : createInMemoryTaskStore();
    a2aCache.set(tenantId, store);
    return store;
  }

  deps.logger?.info?.(
    { where: 'persistent-stores-wiring', modeByStore },
    'persistent stores wired',
  );

  return {
    lessonStore,
    wormAuditStore,
    skillRegistryWriter,
    aopRegistryStore,
    getA2aTaskStore,
    modeByStore: Object.freeze(modeByStore),
  };
}

/**
 * Null-object AOPRegistryStore — used when the operator explicitly
 * disabled the persistent path but no in-memory store is wired at this
 * layer. The kernel layer always wires its own in-memory default via
 * `createInMemoryAOPRegistryStore()`, so this object is a safety net,
 * not a functional surface. Matches the AOPRegistryStore port shape
 * defined in `central-intelligence/agent/aops/aop-registry.ts`.
 */
const NULL_AOP_REGISTRY_STORE: AOPRegistryStore = {
  async putSpec() {
    /* no-op */
  },
  async listSpecs() {
    return [];
  },
  async putRegressionSet() {
    /* no-op */
  },
  async listRegressionSets() {
    return [];
  },
  async putActiveVersion() {
    /* no-op */
  },
  async listActiveVersions() {
    return [];
  },
};
