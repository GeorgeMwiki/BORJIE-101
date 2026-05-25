/**
 * Sentry integration — shared client setup for every service.
 *
 * Reads SENTRY_DSN from the environment. If no DSN is present, all calls
 * become no-ops so unit tests and local dev keep working.
 *
 * IMPORTANT: this module takes a lazy-import approach so that apps which
 * don't install `@sentry/node` don't blow up at require-time. The real
 * Sentry client is only loaded when `initSentry({ dsn })` is called with
 * a non-empty DSN.
 */

import type { LoggerContext } from './logging/logger.js';

export interface SentryConfig {
  /** DSN (from SENTRY_DSN env). If empty, Sentry is disabled. */
  dsn?: string;
  /** Service name (e.g. 'api-gateway', 'customer-app') */
  service: string;
  /** Runtime environment: development | staging | production */
  environment?: string;
  /** Release identifier (git sha). */
  release?: string;
  /** Trace sample rate (0.0–1.0). Default: 0.1 */
  tracesSampleRate?: number;
  /** Custom PII scrubber callback (defaults to the platform pii-scrubber) */
  scrubber?: (input: string) => string;
}

export interface SentryClient {
  captureException: (err: unknown, context?: LoggerContext) => void;
  captureMessage: (msg: string, context?: LoggerContext) => void;
  addBreadcrumb: (b: { category: string; message: string; level?: string }) => void;
  flush: (timeoutMs?: number) => Promise<boolean>;
  isEnabled: () => boolean;
}

const noopClient: SentryClient = {
  captureException: () => {},
  captureMessage: () => {},
  addBreadcrumb: () => {},
  flush: async () => true,
  isEnabled: () => false,
};

let activeClient: SentryClient = noopClient;

/**
 * Initialize Sentry. Safe to call multiple times; subsequent calls replace
 * the active client.
 */
export async function initSentry(config: SentryConfig): Promise<SentryClient> {
  if (!config.dsn) {
    activeClient = noopClient;
    return activeClient;
  }

  try {
    // Lazy import — only required at runtime in services that opt in.
    const Sentry = await import('@sentry/node').catch(() => null);
    if (!Sentry) {
      activeClient = noopClient;
      return activeClient;
    }

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment ?? 'production',
      release: config.release,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
      serverName: config.service,
      beforeSend(event) {
        // Run every string field through the PII scrubber.
        if (config.scrubber && event.message) {
          event.message = config.scrubber(event.message);
        }
        if (config.scrubber && event.exception?.values) {
          event.exception.values = event.exception.values.map((v) => ({
            ...v,
            value: v.value ? config.scrubber!(v.value) : v.value,
          }));
        }
        return event;
      },
    });

    activeClient = {
      captureException: (err, ctx) => {
        Sentry.withScope((scope) => {
          if (ctx?.tenantId) scope.setTag('tenantId', ctx.tenantId);
          if (ctx?.userId) scope.setUser({ id: ctx.userId });
          if (ctx?.requestId) scope.setTag('requestId', ctx.requestId);
          if (ctx?.attributes) {
            for (const [k, v] of Object.entries(ctx.attributes)) {
              scope.setExtra(k, v);
            }
          }
          Sentry.captureException(err);
        });
      },
      captureMessage: (msg, ctx) => {
        Sentry.withScope((scope) => {
          if (ctx?.tenantId) scope.setTag('tenantId', ctx.tenantId);
          if (ctx?.userId) scope.setUser({ id: ctx.userId });
          const scrubbed = config.scrubber ? config.scrubber(msg) : msg;
          Sentry.captureMessage(scrubbed);
        });
      },
      addBreadcrumb: (b) =>
        Sentry.addBreadcrumb({ ...b, level: (b.level as 'info') ?? 'info' }),
      flush: (ms = 2000) => Sentry.flush(ms),
      isEnabled: () => true,
    };
    return activeClient;
  } catch {
    activeClient = noopClient;
    return activeClient;
  }
}

/**
 * Get the active Sentry client. Returns a no-op client if initSentry was not
 * called with a DSN.
 */
export function getSentry(): SentryClient {
  return activeClient;
}

/**
 * Wrap an async top-level handler so any thrown error is reported to Sentry
 * and re-thrown.
 */
export function withSentry<T extends (...a: unknown[]) => Promise<unknown>>(
  handler: T,
  contextFn?: (...a: Parameters<T>) => LoggerContext,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      const ctx = contextFn ? contextFn(...args) : undefined;
      activeClient.captureException(err, ctx);
      throw err;
    }
  }) as T;
}

/**
 * Install process-wide handlers for unhandled errors.
 */
export function installGlobalSentryHandlers(): void {
  if (typeof process === 'undefined') return;
  process.on('unhandledRejection', (reason) => {
    activeClient.captureException(reason);
  });
  process.on('uncaughtException', (err) => {
    activeClient.captureException(err);
  });
}
