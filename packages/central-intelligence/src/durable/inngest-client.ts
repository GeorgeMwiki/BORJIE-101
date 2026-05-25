/**
 * Inngest client wiring for BORJIE.
 *
 * Inngest is the durable-execution layer that turns the existing
 * `TaskAgentExecutor` (in `@borjie/ai-copilot/task-agents`) from a
 * fire-and-forget cron worker into a crash-resilient state machine. A
 * crash mid-batch no longer retries the whole cron — Inngest resumes
 * from the last completed step.
 *
 * Background (Phase F + .audit/litfin-sota-2026-05-23/16-agent-orchestration-teams.md):
 *   The audit grades durable execution as "the single biggest reliability
 *   lift" for the agent registry. Long-horizon flows — eviction (≤ 30
 *   days), monthly close, lease renewal — need every LLM call, tool
 *   call, and DB write to become a resumable checkpoint.
 *
 * Design constraints:
 *   - `inngest` is an OPTIONAL peer dep. The kernel must type-check and
 *     run tests without it installed. Code that touches the SDK lives
 *     behind a structural port (`InngestClientLike`) and a factory the
 *     caller injects.
 *   - Composition-root style: this module wires config + ports; agents
 *     and flows are declared in `./functions/*` and `./inngest-executor`.
 *   - Feature-flagged: `DURABLE_EXEC_ENABLED=true` is the only way the
 *     api-gateway opts into the wrapper. Default `false` preserves the
 *     legacy sync executor verbatim.
 *
 * Env vars (documented for ops):
 *   - `INNGEST_EVENT_KEY`     — write key used by the producer side
 *                               (sending events to the Inngest cloud /
 *                               self-hosted dev server). Required when
 *                               `DURABLE_EXEC_ENABLED=true` in prod.
 *   - `INNGEST_SIGNING_KEY`   — HMAC key used by the consumer side
 *                               (verifying requests from the Inngest
 *                               control plane to our function endpoint).
 *                               Required when running the serve handler.
 *   - `DURABLE_EXEC_ENABLED`  — `"true"` opts into the durable wrapper.
 *                               Anything else falls back to the sync
 *                               executor.
 */

// ---------------------------------------------------------------------------
// Structural ports — let the kernel compile without `inngest` installed.
// ---------------------------------------------------------------------------

/**
 * Subset of `inngest@^3`'s `step` API we depend on. Tests pass a hand-
 * rolled in-memory stub that mirrors `step.run`'s memoization contract
 * (the same key returns the same value on replay).
 */
export interface DurableStepLike {
  /**
   * Run a unit of work under a stable id. Inngest memoizes the result by
   * (functionId, runId, stepId) so a crash + replay returns the prior
   * value instead of re-invoking the body.
   */
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  /**
   * Sleep until an absolute timestamp. Used by multi-day flows so the
   * runtime can suspend the function and resume on schedule.
   */
  sleepUntil?(id: string, isoTimestamp: string): Promise<void>;
}

/** Function-invocation context Inngest hands to every function body. */
export interface DurableFunctionContext<TEvent = unknown> {
  readonly event: TEvent;
  readonly step: DurableStepLike;
  readonly runId?: string;
}

/** A registered Inngest function. The shape mirrors `client.createFunction`. */
export interface DurableFunctionDefinition {
  readonly id: string;
  readonly name?: string;
  readonly trigger:
    | { readonly event: string }
    | { readonly cron: string };
  readonly handler: (ctx: DurableFunctionContext) => Promise<unknown>;
}

/**
 * Structural shape of the Inngest client. The real SDK type is wider —
 * we keep only what the wrapper actually calls.
 */
export interface InngestClientLike {
  /** Enqueue an event onto the durable bus. */
  send(args: {
    readonly name: string;
    readonly data: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
  /** Register a durable function under this client. */
  createFunction(def: DurableFunctionDefinition): DurableFunctionDefinition;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface InngestClientConfig {
  /**
   * Stable id used for both event-key namespacing and function-id
   * prefixing. One per service.
   */
  readonly appId: string;
  /**
   * Inngest event key (`INNGEST_EVENT_KEY`). Required for the producer
   * side in prod. In dev / tests the local Inngest dev-server accepts
   * any key.
   */
  readonly eventKey?: string;
  /**
   * Inngest signing key (`INNGEST_SIGNING_KEY`). Required for the
   * consumer side (the `/api/inngest` HTTP handler) so the control plane
   * can verify the function endpoint.
   */
  readonly signingKey?: string;
  /**
   * Master kill-switch. Mirrors `process.env.DURABLE_EXEC_ENABLED`.
   * Default `false` — callers fall back to the legacy sync executor.
   */
  readonly enabled?: boolean;
}

export interface InngestComposition {
  readonly client: InngestClientLike;
  readonly config: InngestClientConfig;
  readonly enabled: boolean;
}

/**
 * Factory callers pass when they want the real `inngest` SDK wired up.
 * Keeping it injectable means this package never imports `inngest` at
 * the top level — TS type-checks cleanly even when the SDK is absent.
 *
 * Production wiring (composition root):
 *
 *   import { Inngest } from 'inngest';
 *   const composition = createInngestComposition({
 *     config: {
 *       appId: 'borjie-api-gateway',
 *       eventKey: process.env.INNGEST_EVENT_KEY,
 *       signingKey: process.env.INNGEST_SIGNING_KEY,
 *       enabled: process.env.DURABLE_EXEC_ENABLED === 'true',
 *     },
 *     clientFactory: (cfg) =>
 *       new Inngest({
 *         id: cfg.appId,
 *         eventKey: cfg.eventKey,
 *         signingKey: cfg.signingKey,
 *       }) as unknown as InngestClientLike,
 *   });
 */
export type InngestClientFactory = (
  config: InngestClientConfig,
) => InngestClientLike;

/**
 * Build the kernel-side Inngest composition. The wrapper returns the
 * client + the resolved `enabled` flag so callers can branch once
 * instead of re-reading `process.env` in every hot path.
 *
 * The factory is required when `enabled === true`. When `enabled` is
 * false we hand back a no-op client so callers never have to guard
 * against `null` on the read side — they simply never publish events
 * because the executor wrapper short-circuits earlier.
 */
export function createInngestComposition(args: {
  readonly config: InngestClientConfig;
  readonly clientFactory?: InngestClientFactory;
}): InngestComposition {
  const enabled = args.config.enabled === true;
  if (!enabled) {
    return {
      client: createNoopInngestClient(),
      config: args.config,
      enabled: false,
    };
  }
  if (!args.clientFactory) {
    throw new Error(
      'createInngestComposition: clientFactory is required when enabled=true. ' +
        'Pass a factory that returns an Inngest instance (e.g. () => new Inngest({...})).',
    );
  }
  // Hard fail in prod when the producer-side key is missing.
  if (!args.config.eventKey) {
    throw new Error(
      'createInngestComposition: INNGEST_EVENT_KEY is required when DURABLE_EXEC_ENABLED=true.',
    );
  }
  return {
    client: args.clientFactory(args.config),
    config: args.config,
    enabled: true,
  };
}

/**
 * No-op client used when durable execution is disabled. `send` is a
 * silent drop and `createFunction` returns the definition unchanged so
 * application code that registers functions at boot-time still compiles
 * (the function just never fires).
 */
export function createNoopInngestClient(): InngestClientLike {
  return {
    async send() {
      return undefined;
    },
    createFunction(def) {
      return def;
    },
  };
}

// ---------------------------------------------------------------------------
// Local dev-server client
// ---------------------------------------------------------------------------

/**
 * Default URL of `npx inngest-cli@latest dev`. The CLI binds to
 * `:8288` by default. Override via `INNGEST_DEV_URL`.
 */
export const INNGEST_LOCAL_DEV_URL = 'http://localhost:8288';

/** Default app id for the local dev client when no opts are supplied. */
export const INNGEST_LOCAL_DEV_APP_ID = 'borjie-local-dev';

/** Minimal `fetch` surface — lets tests inject a mock without DOM types. */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export interface LocalDevInngestClientOpts {
  /** App id used as the event-key path component. Default: `borjie-local-dev`. */
  readonly appId?: string;
  /** Base URL of the local dev server. Default: `http://localhost:8288`. */
  readonly baseUrl?: string;
  /**
   * Master gate. When `false` (or unset) the factory returns a no-op
   * client. The composition root reads `INNGEST_DEV=1` and forwards.
   */
  readonly enabled?: boolean;
  /** Custom fetch — defaults to `globalThis.fetch`. Tests inject a stub. */
  readonly fetch?: FetchLike;
  /** Optional sink for transport errors so callers can log them. */
  readonly onError?: (err: unknown) => void;
}

/**
 * Local-dev Inngest client. Mirrors the `InngestClientLike` port and
 * sends events to `<baseUrl>/e/<appId>` — the URL shape `inngest-cli dev`
 * accepts on its event ingest endpoint.
 *
 * Behaviour:
 *   - `INNGEST_DEV=1` env (or `enabled: true`) → real HTTP client.
 *   - Anything else → no-op client (same shape as `createNoopInngestClient`),
 *     so callers never branch.
 *
 * To start the dev server locally:
 *   `npx inngest-cli@latest dev`
 *
 * See `docs/INNGEST-LOCAL.md` for the full setup.
 */
export function createLocalDevInngestClient(
  opts: LocalDevInngestClientOpts = {},
): InngestClientLike {
  const envEnabled = isTruthyEnv(readEnv('INNGEST_DEV'));
  const enabled = opts.enabled ?? envEnabled;
  if (!enabled) return createNoopInngestClient();

  const appId = opts.appId ?? INNGEST_LOCAL_DEV_APP_ID;
  const baseUrl = opts.baseUrl ?? readEnv('INNGEST_DEV_URL') ?? INNGEST_LOCAL_DEV_URL;
  const fetcher: FetchLike | undefined =
    opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetcher) {
    throw new Error(
      'createLocalDevInngestClient: no `fetch` available. Provide opts.fetch or run on Node>=18 / a fetch-capable runtime.',
    );
  }

  const endpoint = `${stripTrailingSlash(baseUrl)}/e/${encodeURIComponent(appId)}`;

  return {
    async send(args) {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: args.name, data: args.data }),
        });
      } catch (err) {
        // Transport-level failure (DNS, conn refused, etc.) — surface
        // once and rethrow. The CLI not running locally lands here.
        opts.onError?.(err);
        throw err;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(
          `inngest local-dev: send failed (${res.status}) ${body}`.trim(),
        );
        opts.onError?.(err);
        throw err;
      }
      return undefined;
    },
    createFunction(def) {
      // The dev-server client does NOT run functions itself — that is the
      // job of the `inngest-cli dev` process polling the registered serve
      // handler. Returning the definition unchanged keeps the structural
      // contract identical to the production client.
      return def;
    },
  };
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return env?.[name];
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
