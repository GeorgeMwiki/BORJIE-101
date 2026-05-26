//   dependency-injection helpers below intentionally type-erase to keep
//   the wiring layer free of subpath import noise.

/**
 * Lazy advisor wiring.
 *
 * Builds + caches a single `AdvisorApi` instance per process. Each port
 * wires the REAL implementation first, with a defensive try/catch that
 * falls back to the safe in-memory default bundled with
 * `@borjie/role-aware-advisor` if the real wiring throws:
 *
 *   - BrainPort  — `wireMultiLLMBrain({ env })` (Claude Sonnet +
 *                  GPT-4o + DeepSeek proposers, Claude Opus
 *                  synthesizer). Falls back to `createEchoBrain()`
 *                  when no Anthropic key is set OR fewer than 2
 *                  proposer vendors are configured.
 *
 *   - DataPort   — `wireUserContextDataPort({ db, embedder, audit,
 *                  index })`. Falls back to `createStaticDataPort([])`
 *                  when `db` is null or the user-context-store cannot
 *                  be constructed.
 *
 *   - AuditPort  — the persistent wormAuditStore from
 *                  `createPersistentStores({ db })`. The store's
 *                  `append({...})` is structurally identical to the
 *                  advisor's `AuditPort.append`, so the wormAuditStore
 *                  itself serves as the AuditPort directly. Falls back
 *                  to `createInMemoryAuditPort()` if construction
 *                  throws.
 *
 * The boundary is intentional — this file is the SINGLE point that wires
 * the three external surfaces. Routes import only `getAdvisor()` (plus
 * `getAdvisorWiringStatus()` for ops dashboards).
 *
 * NEVER lets the gateway crash: every wire is wrapped in a try/catch
 * that emits a structured warning and falls back to the bundled
 * in-memory default. The advisor is a non-critical surface (routes can
 * 503 cleanly) but the route should NEVER fail at module-load time.
 */

import {
  createAdvisor,
  createEchoBrain,
  createStaticDataPort,
  createInMemoryAuditPort,
  type AdvisorApi,
  type AuditPort,
  type BrainPort,
  type DataPort,
} from '@borjie/role-aware-advisor';
import {
  createMockEmbedder,
  createOpenAIEmbedder,
  InMemoryCorpusIndex,
  nullAuditSink,
} from '@borjie/user-context-store';
import { createPersistentStores } from '../../composition/persistent-stores-wiring.js';
import { wireMultiLLMBrain } from '../../composition/multi-llm-brain-adapter.js';
import { wireUserContextDataPort } from '../../composition/user-context-data-port-adapter.js';
import { getDb } from '../../composition/db-client.js';
import { logger } from '../../utils/logger.js';

// ─── Status labels ────────────────────────────────────────────────

export type BrainWiringLabel = 'multi-llm-synthesizer' | 'echo-fallback';
export type DataWiringLabel = 'user-context-store' | 'static-fallback';
export type AuditWiringLabel = 'worm-audit-store' | 'in-memory-fallback';

export interface AdvisorWiringStatus {
  readonly brain: BrainWiringLabel;
  readonly data: DataWiringLabel;
  readonly audit: AuditWiringLabel;
}

// ─── Override + cache state ───────────────────────────────────────

interface AdvisorDepsOverride {
  brain?: BrainPort;
  data?: DataPort;
  audit?: AuditPort;
}

let cachedAdvisor: AdvisorApi | null = null;
let cachedAudit: AuditPort | null = null;
let cachedStatus: AdvisorWiringStatus | null = null;

// ─── Internal builders (each defensive — never throws) ────────────

function buildBrainPort(): { port: BrainPort; label: BrainWiringLabel } {
  try {
    const real = wireMultiLLMBrain({
      env: process.env,
      logger: {
        info: (msg, meta) => logger.info(msg, meta),
        warn: (msg, meta) => logger.warn(msg, meta),
      },
    });
    if (real) {
      return { port: real, label: 'multi-llm-synthesizer' };
    }
    logger.info('advisor-wiring: multi-LLM brain returned null — falling back to echo brain', {
      where: 'advisor-wiring',
    });
  } catch (err) {
    logger.warn('advisor-wiring: multi-LLM brain wiring threw — falling back to echo brain', {
      where: 'advisor-wiring',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { port: createEchoBrain(), label: 'echo-fallback' };
}

function buildDataPort(): { port: DataPort; label: DataWiringLabel } {
  try {
    // The data port wraps user-context-store. We need:
    //   - db (or null in degraded mode — the store handles it)
    //   - embedder (OpenAI if key set, deterministic mock otherwise)
    //   - audit (null sink — the advisor's AuditPort handles its own
    //     audit row separately; the store's audit is per-fetch)
    //   - index (empty in degraded mode — the store still returns
    //     profile + signal snippets without it)
    const db = getDb();
    if (!db) {
      // Degraded mode — the store would still construct, but with no
      // db it returns empty profile snippets. Skip the construction
      // cost entirely and fall back to the static empty port.
      logger.info('advisor-wiring: no DATABASE_URL — data port is static-fallback', {
        where: 'advisor-wiring',
      });
      return { port: createStaticDataPort([]), label: 'static-fallback' };
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const embedder =
      apiKey && apiKey.length > 0
        ? createOpenAIEmbedder({ apiKey })
        : createMockEmbedder({ dimension: 1536 });
    const index = new InMemoryCorpusIndex(embedder);

    const real = wireUserContextDataPort({
      db,
      embedder,
      audit: nullAuditSink,
      index,
    });
    return { port: real, label: 'user-context-store' };
  } catch (err) {
    logger.warn(
      'advisor-wiring: user-context data port wiring threw — falling back to static empty port',
      {
        where: 'advisor-wiring',
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return { port: createStaticDataPort([]), label: 'static-fallback' };
  }
}

function buildAuditPort(): { port: AuditPort; label: AuditWiringLabel } {
  try {
    const db = getDb();
    // `createPersistentStores` builds the in-memory worm shim when db
    // is null AND the real Drizzle-backed store when db is set. Either
    // way it satisfies the AuditPort shape structurally — the store's
    // `append({...})` matches `AuditPort.append`.
    const stores = createPersistentStores({ db });
    const wormStore = stores.wormAuditStore as unknown as AuditPort;
    const mode = stores.modeByStore['wormAuditStore'];
    if (mode === 'persistent') {
      return { port: wormStore, label: 'worm-audit-store' };
    }
    // In-memory fallback path (db null OR PERSISTENT_WORM_AUDIT_DISABLED
    // is set). The shim satisfies the contract; we report the fallback
    // label so ops can tell the difference at a glance.
    return { port: wormStore, label: 'in-memory-fallback' };
  } catch (err) {
    logger.warn(
      'advisor-wiring: WORM audit port wiring threw — falling back to in-memory audit port',
      {
        where: 'advisor-wiring',
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return { port: createInMemoryAuditPort(), label: 'in-memory-fallback' };
  }
}

// ─── Public surface ───────────────────────────────────────────────

/**
 * Get the singleton advisor for this process. First call constructs
 * with the real-wired ports (falling back to in-memory defaults per
 * port if a wire throws). Passing `overrides` resets the singleton
 * and substitutes the provided ports for that build.
 *
 * Routes call this with no arguments; tests pass overrides to exercise
 * a deterministic port.
 */
export function getAdvisor(overrides?: AdvisorDepsOverride): AdvisorApi {
  if (overrides && Object.keys(overrides).length > 0) {
    const brain = overrides.brain ?? createEchoBrain();
    const data = overrides.data ?? createStaticDataPort([]);
    const audit = overrides.audit ?? createInMemoryAuditPort();
    cachedAudit = audit;
    cachedAdvisor = createAdvisor({ brain, data, audit });
    cachedStatus = {
      brain: overrides.brain ? 'multi-llm-synthesizer' : 'echo-fallback',
      data: overrides.data ? 'user-context-store' : 'static-fallback',
      audit: overrides.audit ? 'worm-audit-store' : 'in-memory-fallback',
    };
    return cachedAdvisor;
  }
  if (cachedAdvisor) return cachedAdvisor;

  const brain = buildBrainPort();
  const data = buildDataPort();
  const audit = buildAuditPort();
  cachedAudit = audit.port;
  cachedAdvisor = createAdvisor({ brain: brain.port, data: data.port, audit: audit.port });
  cachedStatus = { brain: brain.label, data: data.label, audit: audit.label };

  logger.info('advisor-wiring: ports wired', {
    where: 'advisor-wiring',
    brain: brain.label,
    data: data.label,
    audit: audit.label,
  });

  return cachedAdvisor;
}

/**
 * Wiring-status snapshot — surfaces which path each port took at
 * boot. Returns null when `getAdvisor()` has not been called yet.
 *
 * Routes do not consume this; ops endpoints / health checks call it
 * to render a single-line diagnostic showing the live posture.
 */
export function getAdvisorWiringStatus(): AdvisorWiringStatus | null {
  return cachedStatus;
}

/** Test helper — get the last audit port wired so tests can inspect entries. */
export function _getCachedAuditPortForTests(): AuditPort | null {
  return cachedAudit;
}

/** Test helper — wipe the singleton so the next call rebuilds. */
export function _resetAdvisorForTests(): void {
  cachedAdvisor = null;
  cachedAudit = null;
  cachedStatus = null;
}
