/**
 * GET /healthz/dependencies — degraded-mode visibility for every external
 * integration BORJIE depends on.
 *
 * Surfaces (Round-4 audit, HIGH):
 *   - NOT_YET_WIRED placeholder slots (NIDA, e-Ardhi, KRA-MRI dispatcher,
 *     owner-payout dispatcher, eviction dispatcher, etc.) so operators
 *     can see which capabilities are still on heuristic baselines.
 *   - LLM provider key presence (Anthropic / OpenAI / DeepSeek). Without
 *     a key the gateway falls back to the polite degraded stub.
 *   - Infra integrations the gateway can introspect via env presence
 *     (DATABASE_URL, REDIS_URL, GEPG_HEALTH_URL, ELEVENLABS_API_KEY,
 *     SENTRY_DSN, INNGEST_SIGNING_KEY).
 *
 * Status semantics:
 *   - `healthy`   — env vars set AND wiring slot bound (not a stub).
 *   - `degraded`  — env vars set BUT the underlying adapter is a
 *                   NOT_YET_WIRED placeholder; OR the LLM-provider key
 *                   is set but the client has been observed to be in
 *                   cooldown.
 *   - `down`      — required env vars unset AND no fallback is wired.
 *   - `unknown`   — sub-source threw / state isn't trackable from this
 *                   process (e.g. the kernel's SensorRouter handle isn't
 *                   exposed through `service-registry`).
 *
 * Endpoint contract:
 *   - Never returns 5xx even if a sub-source throws — per-dependency
 *     errors collapse to `status: 'unknown'`.
 *   - `lastSuccessAt` is `null` when timing isn't tracked; consumers
 *     should treat `null` as "never observed since process boot".
 *   - Cache-Control: no-cache. Operators want fresh state.
 *
 * NOT a Kubernetes liveness/readiness probe — this is a dashboard feed.
 * Use `/health` + `/healthz` for the k8s contract.
 *
 * Public vs admin surfaces (DA1 audit fix, CRITICAL):
 *   - `GET /healthz/dependencies` — PUBLIC roll-up only: `{ overall,
 *     timestamp }`. Safe for unauthenticated callers (load balancers,
 *     uptime probes, status pages). Reveals no connector names, env-var
 *     names, NOT_YET_WIRED tokens, or last-success timestamps.
 *   - `GET /admin/healthz/dependencies` — FULL detail (per-dependency
 *     reports, env-var names, NOT_YET_WIRED tokens). Gated behind
 *     `authMiddleware + requireRole(SUPER_ADMIN, ADMIN)` so internal
 *     monitoring + admin UI can still call it.
 *
 * Both surfaces share the same payload builder; the public handler
 * strips everything except `{ overall, timestamp }` before responding.
 */

import { Hono } from 'hono';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { NOT_YET_WIRED_REASON } from '@borjie/central-intelligence';

export type DependencyStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface DependencyReport {
  readonly name: string;
  readonly status: DependencyStatus;
  readonly lastSuccessAt: string | null;
  readonly note?: string;
  readonly affectedCapabilities?: ReadonlyArray<string>;
}

export interface HealthDependenciesPayload {
  readonly overall: DependencyStatus;
  readonly timestamp: string;
  readonly dependencies: Readonly<Record<string, DependencyReport>>;
}

/**
 * Optional state-source ports the composition root may wire so the
 * endpoint can return richer data than env presence alone.
 *
 * - `sensorDegradedSnapshot()` returns the brain's `SensorRouter.
 *   getDegradedState()` result. When wired, the endpoint emits a
 *   per-LLM-provider `sensor:<id>` dependency with breaker state.
 * - `notYetWiredAdapters()` returns a list of currently-stubbed
 *   adapter reason tokens (e.g. `['nida-port', 'eviction-dispatcher']`).
 *   Composition root collects these at build time.
 * - `connectorLastSuccess(name)` returns the wall-clock ms of the last
 *   successful call to the named connector. `null` when not tracked.
 *
 * All three are optional — the endpoint falls back to env presence
 * when a port isn't wired.
 */
export interface HealthDependenciesDeps {
  readonly sensorDegradedSnapshot?: () => {
    readonly degraded: boolean;
    readonly currentProvider: string | null;
    readonly degradedAt: number | null;
    readonly lastFailedAt: number | null;
    readonly openSensors: ReadonlyArray<string>;
  } | null;
  readonly notYetWiredAdapters?: () => ReadonlyArray<string>;
  readonly connectorLastSuccess?: (name: string) => number | null;
  /** Test seam — overrides `Date.now()` for deterministic snapshots. */
  readonly clock?: () => Date;
  /** Test seam — overrides `process.env` for hermetic probes. */
  readonly env?: NodeJS.ProcessEnv;
}

type EnvPresenceCheck = {
  readonly name: string;
  readonly envVars: ReadonlyArray<string>;
  readonly note: string;
  /** Tag applied as `affectedCapabilities` when this slot is degraded. */
  readonly capabilities: ReadonlyArray<string>;
};

// Static map of every external integration the gateway can probe by
// env-presence. New connectors get added here as they're introduced.
const ENV_PRESENCE_CHECKS: ReadonlyArray<EnvPresenceCheck> = Object.freeze([
  {
    name: 'postgres',
    envVars: ['DATABASE_URL'],
    note: 'primary OLTP store',
    capabilities: ['db.read', 'db.write'],
  },
  {
    name: 'redis',
    envVars: ['REDIS_URL'],
    note: 'rate-limit + cache backplane',
    capabilities: ['rate-limit', 'session-cache'],
  },
  {
    name: 'anthropic-llm',
    envVars: ['ANTHROPIC_API_KEY'],
    note: 'primary LLM sensor',
    capabilities: ['llm.primary', 'vision', 'thinking'],
  },
  {
    name: 'openai-llm',
    envVars: ['OPENAI_API_KEY'],
    note: 'secondary LLM sensor + embeddings',
    capabilities: ['llm.secondary', 'embeddings'],
  },
  {
    name: 'deepseek-llm',
    envVars: ['DEEPSEEK_API_KEY'],
    note: 'budget-tier LLM sensor',
    capabilities: ['llm.budget'],
  },
  {
    name: 'elevenlabs-voice',
    envVars: ['ELEVENLABS_API_KEY'],
    note: 'voice synthesis',
    capabilities: ['voice.tts'],
  },
  {
    name: 'gepg-payments',
    envVars: ['GEPG_HEALTH_URL'],
    note: 'TZ government payments gateway',
    capabilities: ['payments.gepg'],
  },
  {
    name: 'inngest',
    envVars: ['INNGEST_SIGNING_KEY'],
    note: 'durable execution webhook',
    capabilities: ['workflows.durable'],
  },
  {
    name: 'sentry',
    envVars: ['SENTRY_DSN'],
    note: 'error tracking',
    capabilities: ['observability.errors'],
  },
  {
    name: 'nida-connector',
    envVars: ['NIDA_GATEWAY_URL', 'NIDA_API_KEY'],
    note: 'TZ biometric identity gateway',
    capabilities: [NOT_YET_WIRED_REASON.NIDA_PORT],
  },
  {
    name: 'eardhi-connector',
    envVars: ['EARDHI_GATEWAY_URL'],
    note: 'TZ e-Ardhi title-deed gateway',
    capabilities: [NOT_YET_WIRED_REASON.EARDHI_PORT],
  },
  {
    name: 'kra-mri-dispatcher',
    envVars: ['TEMPORAL_ADDRESS', 'KRA_MRI_TASKQUEUE'],
    note: 'TZ KRA monthly rental income filer',
    capabilities: [NOT_YET_WIRED_REASON.KRA_MRI_DISPATCHER],
  },
  {
    name: 'eviction-dispatcher',
    envVars: ['TEMPORAL_ADDRESS', 'EVICTION_TASKQUEUE'],
    note: 'sovereign eviction workflow',
    capabilities: [NOT_YET_WIRED_REASON.EVICTION_DISPATCHER],
  },
  {
    name: 'owner-payout-dispatcher',
    envVars: ['TEMPORAL_ADDRESS', 'OWNER_PAYOUT_TASKQUEUE'],
    note: 'sovereign owner-payout workflow',
    capabilities: [NOT_YET_WIRED_REASON.OWNER_PAYOUT_DISPATCHER],
  },
]);

function envHas(env: NodeJS.ProcessEnv, key: string): boolean {
  const v = env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Resolve env-presence status for one dependency entry. Returns
 * `unknown` only when the probe itself throws.
 */
function probeEnvPresence(
  check: EnvPresenceCheck,
  env: NodeJS.ProcessEnv,
  nyw: ReadonlySet<string>,
  lastSuccess: ((name: string) => number | null) | undefined,
  nowMs: number,
): DependencyReport {
  try {
    const allSet = check.envVars.every((v) => envHas(env, v));
    const last = lastSuccess ? lastSuccess(check.name) : null;
    const lastIso =
      typeof last === 'number' && last > 0
        ? new Date(last).toISOString()
        : null;

    // Cross-check against the unwired adapter set. Even when env
    // is set, if the composition root reported this slot as stubbed we
    // surface `degraded`.
    const stubbedKey = check.capabilities.find((c) => nyw.has(c));
    if (stubbedKey) {
      return {
        name: check.name,
        status: 'degraded',
        lastSuccessAt: lastIso,
        note: `${check.note} — adapter is an unwired stub (${stubbedKey})`,
        affectedCapabilities: check.capabilities,
      };
    }

    if (!allSet) {
      return {
        name: check.name,
        status: 'down',
        lastSuccessAt: lastIso,
        note: `${check.note} — required env not set (${check.envVars.join(', ')})`,
        affectedCapabilities: check.capabilities,
      };
    }
    return {
      name: check.name,
      status: 'healthy',
      lastSuccessAt: lastIso ?? new Date(nowMs).toISOString(),
      note: check.note,
    };
  } catch (err) {
    return {
      name: check.name,
      status: 'unknown',
      lastSuccessAt: null,
      note: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
      affectedCapabilities: check.capabilities,
    };
  }
}

function rollUpOverall(
  reports: ReadonlyArray<DependencyReport>,
): DependencyStatus {
  // `down` wins; then `degraded`; then `unknown`; else `healthy`.
  if (reports.some((r) => r.status === 'down')) return 'down';
  if (reports.some((r) => r.status === 'degraded')) return 'degraded';
  if (reports.some((r) => r.status === 'unknown')) return 'unknown';
  return 'healthy';
}

/**
 * Build the response payload. Pure — no I/O, no side-effects. The Hono
 * handler wraps this with a try/catch so even a logic bug below cannot
 * 5xx the endpoint.
 */
export function buildHealthDependenciesPayload(
  deps: HealthDependenciesDeps = {},
): HealthDependenciesPayload {
  const env = deps.env ?? process.env;
  const clockNow = (deps.clock ?? (() => new Date()))();
  const nowMs = clockNow.getTime();

  // Resolve optional state sources. Each is wrapped in try/catch so a
  // misbehaving composition wire cannot break the endpoint.
  let nyw = new Set<string>();
  try {
    if (deps.notYetWiredAdapters) {
      for (const id of deps.notYetWiredAdapters()) nyw.add(id);
    }
  } catch {
    nyw = new Set<string>();
  }

  let sensorReport: DependencyReport | null = null;
  try {
    if (deps.sensorDegradedSnapshot) {
      const snap = deps.sensorDegradedSnapshot();
      if (snap) {
        const lastIso =
          typeof snap.lastFailedAt === 'number' && snap.lastFailedAt > 0
            ? new Date(snap.lastFailedAt).toISOString()
            : null;
        sensorReport = {
          name: 'sensor-router',
          status: snap.degraded
            ? snap.openSensors.length > 0
              ? 'degraded'
              : 'degraded'
            : 'healthy',
          lastSuccessAt: snap.degraded ? lastIso : new Date(nowMs).toISOString(),
          note: snap.degraded
            ? `routing via ${snap.currentProvider ?? 'unknown'}; open=[${snap.openSensors.join(',')}]`
            : 'all sensors closed',
          affectedCapabilities: snap.openSensors.map((id) => `sensor:${id}`),
        };
      }
    }
  } catch (err) {
    sensorReport = {
      name: 'sensor-router',
      status: 'unknown',
      lastSuccessAt: null,
      note: `sensorDegradedSnapshot threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const envReports = ENV_PRESENCE_CHECKS.map((c) =>
    probeEnvPresence(c, env, nyw, deps.connectorLastSuccess, nowMs),
  );
  const allReports = sensorReport ? [...envReports, sensorReport] : envReports;

  const dependencies: Record<string, DependencyReport> = {};
  for (const r of allReports) dependencies[r.name] = r;

  return {
    overall: rollUpOverall(allReports),
    timestamp: clockNow.toISOString(),
    dependencies: Object.freeze(dependencies),
  };
}

/**
 * Factory that returns a Hono router exposing `GET /` (mounted at
 * `/healthz/dependencies` in the api-gateway). The `deps` arg is
 * optional so this router can be unit-tested in isolation; production
 * wiring threads in the sensor + NotYetWired snapshot ports.
 */
export function createHealthDependenciesRouter(
  deps: HealthDependenciesDeps = {},
): Hono {
  const router = new Hono();
  router.get('/', (c) => {
    try {
      const payload = buildHealthDependenciesPayload(deps);
      // Operators want fresh state — never cache this.
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      return c.json(payload);
    } catch (err) {
      // Last-ditch safety net — never let this endpoint 5xx.
      return c.json(
        {
          overall: 'unknown' as DependencyStatus,
          timestamp: new Date().toISOString(),
          dependencies: {},
          error: err instanceof Error ? err.message : String(err),
        },
        200,
      );
    }
  });
  return router;
}

/**
 * Express-adapter form of the dependencies endpoint — same FULL payload,
 * exposed as a plain `(req, res)` handler so the api-gateway can mount
 * it on the top-level Express app with a single `app.get(...)` call.
 *
 * SECURITY: This handler returns the full per-dependency report,
 * including connector names, env-var names, NOT_YET_WIRED tokens, and
 * last-success timestamps. It MUST be mounted behind authentication
 * (`authMiddleware + requireRole(SUPER_ADMIN, ADMIN)`) — see
 * `/admin/healthz/dependencies` in `services/api-gateway/src/index.ts`.
 * For the unauthenticated public surface, use
 * `createHealthDependenciesPublicHandler` (roll-up only).
 *
 * The Hono variant above stays available for tests + alternative mount
 * surfaces.
 */
export function createHealthDependenciesExpressHandler(
  deps: HealthDependenciesDeps = {},
): (req: ExpressRequest, res: ExpressResponse) => void {
  return (_req, res) => {
    try {
      const payload = buildHealthDependenciesPayload(deps);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(payload);
    } catch (err) {
      res.status(200).json({
        overall: 'unknown' as DependencyStatus,
        timestamp: new Date().toISOString(),
        dependencies: {},
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Public reconnaissance-safe roll-up.
 *
 * Audit DA1 (CRITICAL) flagged the unauthenticated full-detail endpoint
 * as a recon leak: it revealed connector names, env-var names,
 * NOT_YET_WIRED tokens, and last-success timestamps to anyone who could
 * reach the gateway. This handler returns ONLY:
 *
 *   { overall: 'healthy' | 'degraded' | 'down' | 'unknown',
 *     timestamp: ISO-8601 }
 *
 * which is enough for an external uptime probe, a load balancer, or a
 * public status page to render an indicator without learning anything
 * actionable about our integration topology.
 */
export interface PublicHealthDependenciesPayload {
  readonly overall: DependencyStatus;
  readonly timestamp: string;
}

export function createHealthDependenciesPublicHandler(
  deps: HealthDependenciesDeps = {},
): (req: ExpressRequest, res: ExpressResponse) => void {
  return (_req, res) => {
    try {
      const full = buildHealthDependenciesPayload(deps);
      const publicPayload: PublicHealthDependenciesPayload = {
        overall: full.overall,
        timestamp: full.timestamp,
      };
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(publicPayload);
    } catch {
      // Last-ditch safety — never 5xx, never leak the error string.
      res.status(200).json({
        overall: 'unknown' as DependencyStatus,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
