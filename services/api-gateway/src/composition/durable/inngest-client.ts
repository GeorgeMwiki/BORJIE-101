/**
 * inngest-client — factory for the Inngest client used by the
 * production durable-execution backend.
 *
 * Why a factory and not a top-level singleton?
 *
 *   1. The api-gateway must boot WITHOUT Inngest in dev / CI (no
 *      `INNGEST_EVENT_KEY`). The factory is invoked lazily by the
 *      composition root so test environments never construct a real
 *      Inngest connection.
 *   2. Composition root decides whether to route through Inngest or
 *      fall back to the in-process custom checkpoint runner (see
 *      `durable-runner.ts`). The decision lives at one site — env
 *      gate inside `createInngestClient`.
 *   3. Tests can pass `{ id }` only and a stub `send()` to validate
 *      the wiring without a real network call.
 *
 * Production wire-up:
 *
 *   - `INNGEST_EVENT_KEY` must be set. When missing, the factory
 *     returns `null` and the durable-runner stays on its custom
 *     checkpoint backend (this is the safe default for CI / local).
 *   - `INNGEST_SIGNING_KEY` (Inngest webhook signature) is consumed
 *     by the webhook router — not this factory — but we surface a
 *     helper here so call sites have a single import.
 *   - The app id is fixed: `borjie-api-gateway`. Changing it
 *     would orphan in-flight Inngest runs, so it is deliberately
 *     hard-coded.
 *
 * NB: this module is INTENTIONALLY a thin wrapper. Most of the
 * Inngest contract is enforced inside the function definitions
 * (`./inngest-functions/`) where step.run() boundaries live.
 */

import type { DurableRunnerLogger } from './durable-runner.js';

/** Stable app id for Inngest. Must not change after first deploy —
 *  Inngest keys in-flight runs by app id. */
export const INNGEST_APP_ID = 'borjie-api-gateway';

/** Public, narrow surface — the durable-runner needs only `send`. */
export interface InngestClientLike {
  /** Inngest event payload — `name` + `data` minimum. */
  send(event: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly id?: string;
  }): Promise<{ ids: ReadonlyArray<string> } | unknown>;
  /** App id — exposed for diagnostic logging. */
  readonly id: string;
}

export interface InngestClientFactoryOptions {
  /** Override the env-driven decision (tests). */
  readonly forceEnabled?: boolean;
  /** Optional explicit event key — defaults to `process.env.INNGEST_EVENT_KEY`. */
  readonly eventKey?: string;
  /** Optional logger — defaults to no-op. */
  readonly logger?: DurableRunnerLogger;
}

/**
 * Decide whether the Inngest backend is active. The runner checks
 * this BEFORE dispatching, so the answer is read once per process.
 */
export function isInngestEnabled(options: InngestClientFactoryOptions = {}): boolean {
  if (typeof options.forceEnabled === 'boolean') return options.forceEnabled;
  const key = options.eventKey ?? process.env.INNGEST_EVENT_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/**
 * Create an Inngest client, or return `null` when Inngest is not
 * configured for this environment. Composition root inspects the
 * result and decides which backend to wire into the durable-runner.
 *
 * The real `inngest` package is imported DYNAMICALLY so the
 * api-gateway can build + test in CI without the dependency
 * installed yet (Phase B integration step ships the install). When
 * the import fails, the factory logs a warning and returns null —
 * the runner falls back to its custom checkpoint backend in that
 * case, which is identical to running with `INNGEST_EVENT_KEY`
 * unset.
 */
export async function createInngestClient(
  options: InngestClientFactoryOptions = {},
): Promise<InngestClientLike | null> {
  if (!isInngestEnabled(options)) return null;
  const logger = options.logger;
  try {
    // Dynamic import — keeps the package tree-shakeable when the dep
    // is absent (CI baseline before `pnpm install` lands).
    // Using a string variable + `import(<expr>)` so TypeScript does not
    // try to resolve the module type at typecheck time; the dep is
    // listed in package.json but install lands at integration.
    const inngestModule = 'inngest';
    const mod = (await import(/* @vite-ignore */ inngestModule).catch(
      () => null,
    )) as
      | { Inngest?: new (cfg: Record<string, unknown>) => InngestClientLike }
      | null;
    if (!mod || typeof mod.Inngest !== 'function') {
      logger?.warn?.(
        { app: INNGEST_APP_ID },
        'inngest-client: package not installed — falling back to in-process runner',
      );
      return null;
    }
    const client = new mod.Inngest({
      id: INNGEST_APP_ID,
      eventKey: options.eventKey ?? process.env.INNGEST_EVENT_KEY,
    });
    logger?.info?.(
      { app: INNGEST_APP_ID },
      'inngest-client: connected',
    );
    return client;
  } catch (err) {
    logger?.error?.(
      {
        app: INNGEST_APP_ID,
        err: err instanceof Error ? err.message : String(err),
      },
      'inngest-client: construction failed — falling back',
    );
    return null;
  }
}

/** Inngest event name for an agency run. Pinned constant so the
 *  webhook router, the function definition and the runner all agree
 *  on a single string. */
export const AGENCY_RUN_EVENT = 'agency/run.requested' as const;

/**
 * Webhook signing-key resolver — used by the inngest webhook router.
 * Centralised so the env-var name stays single-sourced.
 */
export function getInngestSigningKey(): string | null {
  const key = process.env.INNGEST_SIGNING_KEY?.trim();
  return key && key.length > 0 ? key : null;
}
