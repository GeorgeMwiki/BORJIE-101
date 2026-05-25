/**
 * Persona-drift cron — periodic supervisor that runs the 24-dim
 * persona-vector probe every `intervalMs` (default 4 h) over the
 * recent-output reservoir per tenant and writes a
 * `kernel_persona_drift_events` row when the verdict breaches.
 *
 * Phase D D7 closure: the kernel ships the pure
 * `assessPersonaDrift` verdict in
 * `packages/central-intelligence/src/kernel/persona-drift/alert.ts`
 * but until now no production code probed on cadence — drift was
 * only assessed on the inline post-think() path, leaving a long
 * silent tail when generations happened in background jobs.
 *
 * Mirrors `idleSessionEmitter`:
 *
 *   1. Every `intervalMs` (default 4 h) scan the active-tenants
 *      source for distinct `tenantId`s seen in the last
 *      `lookbackHours` (default 24 h).
 *   2. For each tenant, ask the sample source for a recent-output
 *      persona-vector batch. Run the kernel's pure assessor.
 *   3. When the verdict breaches, emit one
 *      `PersonaDriftEvent` per tenant via the wired sink.
 *   4. Memoise emitted (tenant, dayKey) pairs in an LRU so we don't
 *      double-write the same alert within the same 24-h window.
 *   5. Swallow all errors — the cron is a side-channel; it MUST
 *      never throw past its boundary.
 *
 * Sink + sample source are duck-typed so the kernel's deep import
 * path is not picked up at compile time.
 */

import type {
  PersonaVector,
  PersonaVectorDim,
} from '@borjie/central-intelligence';

/** Single recent-output observation tagged with its tenant + persona. */
export interface PersonaVectorObservation {
  readonly tenantId: string;
  readonly personaId: string;
  readonly thoughtId: string;
  readonly capturedAt: string;
  readonly vector: PersonaVector;
}

/**
 * Source of recent persona-vector probes. Production wires this to
 * the kernel's `cot_reservoir` table; tests wire an in-memory list.
 */
export interface PersonaVectorSampleSource {
  listRecent(args: {
    readonly lookbackHours: number;
    readonly perTenantLimit: number;
  }): Promise<ReadonlyArray<PersonaVectorObservation>>;
}

/** Pure verdict shape — duck-typed against kernel `DriftAlertVerdict`. */
export interface PersonaDriftVerdict {
  readonly breached: boolean;
  readonly worstDim: PersonaVectorDim;
  readonly worstDimDrift: number;
  readonly aggregateDrift: number;
  readonly severity: 'low' | 'medium' | 'high';
  readonly reasons: ReadonlyArray<string>;
}

/** Assessor port — duck-typed against kernel `assessPersonaDrift`. */
export type PersonaDriftAssessor = (input: {
  readonly sample: PersonaVector;
}) => PersonaDriftVerdict;

/** Sink port — duck-typed against `PersonaDriftSink`. */
export interface PersonaDriftSinkPort {
  record(event: {
    readonly thoughtId: string;
    readonly personaId: string;
    readonly violationType: 'tone' | 'taboo' | 'identity' | 'language';
    readonly excerpt: string;
    readonly severity: 'low' | 'medium' | 'high';
    readonly detectedAt: string;
  }): Promise<void>;
}

export interface PersonaDriftCronDeps {
  readonly sampleSource: PersonaVectorSampleSource;
  readonly assess: PersonaDriftAssessor;
  readonly sink: PersonaDriftSinkPort;
  /** Override clock — tests supply a deterministic now() in epoch ms. */
  readonly now?: () => number;
  /** Tick interval in ms. Default 4 h. */
  readonly intervalMs?: number;
  /** Lookback window in hours for the recent-output scan. Default 24. */
  readonly lookbackHours?: number;
  /** Max observations per tenant per scan. Default 32. */
  readonly perTenantLimit?: number;
  /** Cap of (tenantId, dayKey) tuples kept as already-emitted. */
  readonly emittedCacheCap?: number;
  /** Optional structured logger. */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface PersonaDriftCron {
  /** Run one scan + emit pass. Returns count of new alerts. Throws never. */
  tick(): Promise<number>;
  start(): void;
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PER_TENANT_LIMIT = 32;
const DEFAULT_EMITTED_CACHE_CAP = 5_000;

export function createPersonaDriftCron(
  deps: PersonaDriftCronDeps,
): PersonaDriftCron {
  if (!deps.sampleSource) {
    throw new Error('createPersonaDriftCron: sampleSource is required');
  }
  if (!deps.assess) {
    throw new Error('createPersonaDriftCron: assess is required');
  }
  if (!deps.sink) {
    throw new Error('createPersonaDriftCron: sink is required');
  }

  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const lookbackHours = deps.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const perTenantLimit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;
  const emittedCap = deps.emittedCacheCap ?? DEFAULT_EMITTED_CACHE_CAP;

  const emitted = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function rememberEmitted(key: string): void {
    if (emitted.has(key)) return;
    if (emitted.size >= emittedCap) {
      const oldest = emitted.values().next().value;
      if (oldest !== undefined) emitted.delete(oldest);
    }
    emitted.add(key);
  }

  function dayKey(epochMs: number): string {
    return new Date(epochMs).toISOString().slice(0, 10); // YYYY-MM-DD
  }

  async function tick(): Promise<number> {
    if (inFlight) return 0;
    inFlight = true;
    try {
      let observations: ReadonlyArray<PersonaVectorObservation> = [];
      try {
        observations = await deps.sampleSource.listRecent({
          lookbackHours,
          perTenantLimit,
        });
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              cron: 'persona-drift',
              error: err instanceof Error ? err.message : String(err),
            },
            'persona-drift-cron: sampleSource.listRecent failed',
          );
        }
        return 0;
      }

      const nowMs = now();
      const day = dayKey(nowMs);
      let emittedThisTick = 0;

      for (const obs of observations) {
        if (
          !obs ||
          !obs.tenantId ||
          !obs.personaId ||
          !obs.thoughtId ||
          !obs.vector
        ) {
          continue;
        }
        const key = `${obs.tenantId}::${obs.personaId}::${day}`;
        if (emitted.has(key)) continue;

        let verdict: PersonaDriftVerdict;
        try {
          verdict = deps.assess({ sample: obs.vector });
        } catch (err) {
          if (deps.logger?.warn) {
            deps.logger.warn(
              {
                cron: 'persona-drift',
                tenantId: obs.tenantId,
                personaId: obs.personaId,
                error: err instanceof Error ? err.message : String(err),
              },
              'persona-drift-cron: assess() threw — skipping observation',
            );
          }
          continue;
        }
        if (!verdict.breached) continue;

        try {
          await deps.sink.record({
            thoughtId: obs.thoughtId,
            personaId: obs.personaId,
            violationType: 'tone',
            excerpt: `cron-detected persona drift: ${verdict.reasons.join('; ')}`,
            severity: verdict.severity,
            detectedAt: new Date(nowMs).toISOString(),
          });
          rememberEmitted(key);
          emittedThisTick += 1;
        } catch (err) {
          if (deps.logger?.warn) {
            deps.logger.warn(
              {
                cron: 'persona-drift',
                tenantId: obs.tenantId,
                personaId: obs.personaId,
                error: err instanceof Error ? err.message : String(err),
              },
              'persona-drift-cron: sink.record failed (will retry next tick)',
            );
          }
        }
      }

      if (deps.logger?.info && emittedThisTick > 0) {
        deps.logger.info(
          {
            cron: 'persona-drift',
            scanned: observations.length,
            emittedThisTick,
            cacheSize: emitted.size,
          },
          'persona-drift-cron: tick complete',
        );
      }
      return emittedThisTick;
    } finally {
      inFlight = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
