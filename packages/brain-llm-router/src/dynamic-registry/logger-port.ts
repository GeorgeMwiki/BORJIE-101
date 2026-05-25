/**
 * Dynamic-registry logger port.
 *
 * Brain-llm-router has zero runtime dependencies — Pino, Winston, and
 * the @borjie/observability Logger all live behind a port so the
 * package stays embeddable in tests, CLI tools, edge runtimes.
 *
 * Composition roots call `setLogger()` once at boot with a real
 * structured logger (typically `services/api-gateway/src/index.ts`'s
 * Pino instance). Until then, all log calls are silently dropped via
 * the no-op default — there is **never** an unstructured `console.*`
 * call on the resolver path.
 */

export interface ResolverLogger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

const NOOP_LOGGER: ResolverLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let injectedLogger: ResolverLogger = NOOP_LOGGER;

export function setLogger(logger: ResolverLogger): void {
  injectedLogger = logger;
}

export function clearLogger(): void {
  injectedLogger = NOOP_LOGGER;
}

export function getLogger(): ResolverLogger {
  return injectedLogger;
}
