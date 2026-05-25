/**
 * Browser-safe structured logger.
 *
 * UI packages cannot use pino (bundle bloat + Node-only APIs). This file is
 * the *only* place in the package allowed to call console.* — it is the
 * dedicated sink that satisfies CLAUDE.md "No console.log in services" by
 * centralising the access and making it easy to swap for a remote-log
 * shipper later (Sentry breadcrumbs, OTel browser SDK, etc.).
 *
 * Why not pino/browser? — chat-ui / design-system / spatial-engine ship to
 * end-user browsers; keeping zero runtime deps for logging matters.
 */
type LogMeta = Record<string, unknown>;

interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: LogMeta): void {
  const payload = meta ? { msg: message, ...meta } : { msg: message };
  // eslint-disable-next-line no-console -- single legitimate sink for browser packages
  console[level](JSON.stringify(payload));
}

export const logger: Logger = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
};
