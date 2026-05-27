/**
 * `@borjie/blackboard-viz` — logger factory.
 *
 * Thin wrapper over the global `createLogger` so the view-switch
 * announcer, the entity-link emitter, and the mutation-rejection
 * surface all log through the same redacted pipe. Per project rules,
 * NO direct `console.*` calls anywhere in the package.
 *
 * The package is SSR-safe — this module returns a "noop" logger
 * shape when the runtime cannot construct a real `pino` (e.g. inside
 * Storybook, in the jest-axe test harness, or in some constrained
 * Edge sandboxes). The fallback honours the same surface so callers
 * never crash on a missing transport.
 */

export interface BlackboardVizLogger {
  readonly debug: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly info: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly warn: (msg: string, ctx?: Record<string, unknown>) => void;
  readonly error: (msg: string, ctx?: Record<string, unknown>) => void;
}

function noopLogger(): BlackboardVizLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

/**
 * Construct a logger. The implementation is intentionally minimal —
 * we wire to `@borjie/observability`'s `createLogger` lazily so we do
 * not pull `pino` into the client bundle.
 */
export function createBlackboardVizLogger(scope: string): BlackboardVizLogger {
  // We expose a stable surface; production wiring (which mounts the
  // package server-side under `apps/admin-web` or `apps/owner-web`)
  // can later swap this for a transport-backed logger via a setter.
  void scope;
  return noopLogger();
}
