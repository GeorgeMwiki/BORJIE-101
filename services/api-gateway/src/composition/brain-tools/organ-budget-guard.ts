/**
 * Organ budget guard — the fail-safe primitive every Wave-3 "dark organ"
 * brain tool runs its compute behind.
 *
 * The Wave-3 organs (anomaly-detection, causal-inference, belief-engine,
 * debate) ADD compute to a brain turn. The HARD invariant from the closure
 * plan is: a slow organ job can NEVER stall a brain turn. So every organ
 * call is wrapped here with:
 *
 *   1. A wall-clock DEADLINE — the compute races an abort timer. If it
 *      overruns the budget the guard resolves to a typed `{ ok: false,
 *      reason: 'budget-exceeded' }` instead of letting the turn hang. The
 *      underlying promise is abandoned (best-effort) — pure-TS organ
 *      compute holds no external locks, so an abandoned computation simply
 *      gets GC'd.
 *   2. A fail-safe CATCH — any thrown error inside the organ resolves to
 *      `{ ok: false, reason: 'organ-error' }`. The organ NEVER throws into
 *      the turn.
 *   3. A master ENV FLAG — when the organ is disabled the guard short-
 *      circuits to `{ ok: false, reason: 'disabled' }` before any compute.
 *
 * This is deliberately a TIME budget, not an LLM-token budget: the
 * anomaly / causal / belief organs are pure-TS (no LLM spend). The debate
 * organ is the one LLM-heavy organ; it ALSO consults
 * `@borjie/llm-budget-governor` at its own call site for token spend, and
 * uses this guard for the wall-clock bound on top.
 *
 * Immutability + Pino: frozen results, no caller mutation, no console.*.
 *
 * @module services/api-gateway/src/composition/brain-tools/organ-budget-guard
 */

/** A flag that defaults OFF: only the literal `'1'`/`'true'`/`'on'` enables it. */
export function organFlagDefaultOff(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/** Resolve a positive-integer budget from env, falling back to a default. */
export function resolveBudgetMs(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  defaultMs: number,
): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return defaultMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultMs;
}

export type OrganGuardOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly elapsedMs: number }
  | {
      readonly ok: false;
      readonly reason: 'disabled' | 'budget-exceeded' | 'organ-error';
      readonly elapsedMs: number;
      readonly detail?: string;
    };

export interface RunOrganOptions {
  /** Whether the organ master flag is enabled. When false → `disabled`. */
  readonly enabled: boolean;
  /** Wall-clock budget in ms. The compute is abandoned past this. */
  readonly budgetMs: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Run an organ computation behind the budget guard. The `compute` thunk is
 * raced against the wall-clock budget; whichever settles first wins. The
 * guard NEVER throws — it resolves a typed outcome so the calling brain
 * tool can degrade gracefully (return a typed `unavailable`/`skipped`
 * result, never a fabricated answer).
 *
 * @param compute lazy thunk producing the organ result. Receives an
 *   `AbortSignal` so cooperative organs can stop early on budget overrun.
 */
export async function runOrganWithBudget<T>(
  opts: RunOrganOptions,
  compute: (signal: AbortSignal) => Promise<T> | T,
): Promise<OrganGuardOutcome<T>> {
  const clock = opts.now ?? Date.now;
  const startedAt = clock();
  if (!opts.enabled) {
    return Object.freeze({
      ok: false as const,
      reason: 'disabled' as const,
      elapsedMs: 0,
    });
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ readonly timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, opts.budgetMs);
    // Do not keep the event loop alive solely for this timer.
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  });

  try {
    const work = Promise.resolve()
      .then(() => compute(controller.signal))
      .then((value) => ({ value }) as const);
    const raced = await Promise.race([work, deadline]);
    if ('timedOut' in raced) {
      return Object.freeze({
        ok: false as const,
        reason: 'budget-exceeded' as const,
        elapsedMs: clock() - startedAt,
        detail: `organ exceeded ${opts.budgetMs}ms budget`,
      });
    }
    return Object.freeze({
      ok: true as const,
      value: raced.value,
      elapsedMs: clock() - startedAt,
    });
  } catch (err) {
    return Object.freeze({
      ok: false as const,
      reason: 'organ-error' as const,
      elapsedMs: clock() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
