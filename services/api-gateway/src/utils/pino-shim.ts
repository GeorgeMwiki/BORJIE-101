/**
 * Pino-shape logger shim.
 *
 * A handful of composition-root ports accept a logger with the Pino
 * `(meta, message)` calling convention. Our local `createLogger` from
 * `./logger.js` is `(message, meta)` — the same primitives, opposite
 * argument order. This shim adapts the project logger to the Pino
 * shape so composition wiring stays free of inline `console.*`
 * fallbacks.
 *
 * Only the three methods used in practice (`info`, `warn`, `error`)
 * are exported. Callers that need `debug` should add it here.
 */
import { createLogger } from './logger.js';

/**
 * Pino-style `(meta, message)` logger shape used by various ports.
 * Accepts any `object` (matches Pino's permissive call site) and a
 * string message. The shim converts both back into the project's
 * `(message, meta)` signature.
 */
export interface PinoLikeLogger {
  info(meta: object, message?: string): void;
  warn(meta: object, message?: string): void;
  error(meta: object, message?: string): void;
}

/**
 * Build a Pino-shape logger that delegates to the project structured
 * logger under the supplied service name.
 */
export function createPinoLikeLogger(service: string): PinoLikeLogger {
  const logger = createLogger(service);
  return {
    info: (meta, message) => logger.info(message ?? '', toMeta(meta)),
    warn: (meta, message) => logger.warn(message ?? '', toMeta(meta)),
    error: (meta, message) => logger.error(message ?? '', toMeta(meta)),
  };
}

function toMeta(meta: object | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  if (Array.isArray(meta)) return { value: meta };
  return meta as Record<string, unknown>;
}
