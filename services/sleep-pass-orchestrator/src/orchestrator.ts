/**
 * Orchestrator — heartbeat ticks (default 60s) → choose due passes
 * → dispatch under AbortController.
 *
 * Single-tick logic is pure for testability (`tick()` returns the
 * dispatch decision without running anything). `run()` drives the
 * interval loop and actually invokes passes. Production wires
 * `start()`/`stop()` from the worker entry-point.
 */

import type {
  HeartbeatTick,
  OrchestratorOptions,
  PassId,
  PassResult,
  PassState,
  SleepPass,
} from './types.js';

const DEFAULT_HEARTBEAT_MS = 60_000;

export interface Orchestrator {
  /** Decide-only — returns the dispatch plan without executing it. */
  decide(): HeartbeatTick;
  /** Decide + execute one cycle. Returns the tick + all results. */
  tick(): Promise<{ tick: HeartbeatTick; results: ReadonlyArray<PassResult> }>;
  /** Start the interval loop. */
  start(): void;
  /** Stop the interval loop. */
  stop(): void;
  /** Inspect state. */
  getState(passId: PassId): PassState | undefined;
}

export function createOrchestrator(opts: OrchestratorOptions): Orchestrator {
  const intervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const now = opts.now ?? (() => new Date());
  const state = new Map<PassId, PassState>();
  for (const pass of opts.passes) {
    state.set(pass.id, {
      lastRunAt: null,
      lastResult: null,
      nextDueAt: nextDueFrom(pass, now()),
    });
  }
  const passById = new Map(opts.passes.map((p) => [p.id, p] as const));
  let timer: ReturnType<typeof setInterval> | null = null;

  function decide(): HeartbeatTick {
    const t = now();
    const tIso = t.toISOString();
    const considered: PassId[] = [];
    const dispatched: PassId[] = [];
    const skipped: Array<{ id: PassId; reason: string }> = [];

    const candidates: Array<{ pass: SleepPass; nextDueAt: number }> = [];
    for (const pass of opts.passes) {
      considered.push(pass.id);
      const ps = state.get(pass.id);
      const nextDue = ps ? Date.parse(ps.nextDueAt) : t.getTime();
      const lastRunMs = ps?.lastRunAt ? Date.parse(ps.lastRunAt) : -Infinity;
      const minGapMs = pass.schedule.minIntervalMinutes * 60_000;
      if (t.getTime() < nextDue) {
        skipped.push({ id: pass.id, reason: 'not-due-yet' });
        continue;
      }
      if (t.getTime() - lastRunMs < minGapMs) {
        skipped.push({ id: pass.id, reason: 'min-interval-not-elapsed' });
        continue;
      }
      candidates.push({ pass, nextDueAt: nextDue });
    }

    candidates.sort((a, b) => {
      const dp = a.pass.schedule.priority - b.pass.schedule.priority;
      if (dp !== 0) return dp;
      return a.nextDueAt - b.nextDueAt;
    });
    for (const c of candidates) dispatched.push(c.pass.id);

    return {
      takenAt: tIso,
      considered,
      dispatched,
      skipped,
    };
  }

  async function tick(): Promise<{
    tick: HeartbeatTick;
    results: ReadonlyArray<PassResult>;
  }> {
    const decision = decide();
    opts.tickSink?.(decision);
    const results: PassResult[] = [];
    for (const id of decision.dispatched) {
      const pass = passById.get(id);
      if (!pass) continue;
      const t = now();
      const result = await runPassWithTimeout(pass, t, now);
      state.set(pass.id, {
        lastRunAt: result.startedAt,
        lastResult: result,
        nextDueAt: nextDueFrom(pass, t),
      });
      results.push(result);
      opts.resultSink?.(result);
    }
    return { tick: decision, results };
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function getState(passId: PassId): PassState | undefined {
    return state.get(passId);
  }

  return { decide, tick, start, stop, getState };
}

async function runPassWithTimeout(
  pass: SleepPass,
  startedAt: Date,
  now: () => Date,
): Promise<PassResult> {
  const startedAtIso = startedAt.toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    pass.schedule.maxDurationMs,
  );
  try {
    const result = await pass.run({
      abortSignal: controller.signal,
      now,
    });
    return result;
  } catch (error) {
    return {
      passId: pass.id,
      itemsProcessed: 0,
      itemsEmitted: 0,
      notes: `errored: ${(error as Error).message ?? 'unknown'}`,
      startedAt: startedAtIso,
      completedAt: now().toISOString(),
      aborted: controller.signal.aborted,
      errored: true,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function nextDueFrom(pass: SleepPass, from: Date): string {
  const cad = pass.schedule.cadence;
  const ms = from.getTime();
  switch (cad.kind) {
    case 'every-minutes':
      return new Date(ms + cad.minutes * 60_000).toISOString();
    case 'hourly': {
      const next = new Date(from);
      next.setUTCMinutes(cad.offsetMinutes, 0, 0);
      if (next.getTime() <= ms) {
        next.setUTCHours(next.getUTCHours() + 1);
      }
      return next.toISOString();
    }
    case 'daily': {
      const next = new Date(from);
      next.setUTCHours(cad.hour, cad.minute, 0, 0);
      if (next.getTime() <= ms) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next.toISOString();
    }
    case 'weekly': {
      const next = new Date(from);
      const day = next.getUTCDay();
      const delta = (cad.dayOfWeek + 7 - day) % 7;
      next.setUTCDate(next.getUTCDate() + delta);
      next.setUTCHours(cad.hour, cad.minute, 0, 0);
      if (next.getTime() <= ms) {
        next.setUTCDate(next.getUTCDate() + 7);
      }
      return next.toISOString();
    }
  }
}
