/**
 * Owner-web Sentry wrapper — pilot-mode aware.
 *
 * Thin abstraction over `@borjie/observability`'s Sentry client + pilot
 * context. Every call attaches the active pilot user / cohort tags so
 * during the 3-5 pilot cohort window EVERY error is captured with
 * enough context for support to act without pinging the pilot.
 *
 * Behaviour
 * ─────────
 * - When `NEXT_PUBLIC_SENTRY_DSN` is set AND `@sentry/react` (or
 *   `@sentry/nextjs`) is installed: forwards events to Sentry with the
 *   pilot tags attached.
 * - When the DSN is missing OR the SDK package is absent: degrades to
 *   structured pino logging via `@borjie/observability/createLogger`.
 *   Errors still land in the platform log sink so the pilot-errors
 *   endpoint can serve them.
 *
 * Upgrade path
 * ────────────
 * To enable Sentry on owner-web, add `@sentry/react` (or `@sentry/nextjs`
 * if SSR error capture is desired) to `apps/owner-web/package.json`,
 * set `NEXT_PUBLIC_SENTRY_DSN`, and call `initOwnerWebSentry()` from
 * `app/layout.tsx`. Until those land, the wrapper logs to stdout and
 * `captureError` is still safe to call from any client component.
 */

import {
  createLogger,
  buildPilotEventContext,
  resolvePilotSampleRate,
  type Logger,
} from '@borjie/observability';

const SERVICE_NAME = 'owner-web';

interface SentryLikeScope {
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
  setUser: (user: { id: string; cohort?: string } | null) => void;
}

interface SentryLike {
  init: (options: Record<string, unknown>) => void;
  captureException: (err: unknown) => void;
  captureMessage: (msg: string, level?: string) => void;
  withScope: (cb: (scope: SentryLikeScope) => void) => void;
}

interface PilotUserSnapshot {
  readonly id?: string;
  readonly cohort?: string;
  readonly replaySessionId?: string;
}

interface CaptureContext {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly route?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

interface WrapperState {
  sentry: SentryLike | null;
  pilotUser: PilotUserSnapshot;
  logger: Logger;
}

const state: WrapperState = {
  sentry: null,
  pilotUser: Object.freeze({}),
  logger: createLogger({
    service: {
      name: SERVICE_NAME,
      version: process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev',
      environment: process.env.NODE_ENV ?? 'development',
    },
    logLevel: 'info',
    consoleExport: process.env.NODE_ENV !== 'production',
  } as never),
};

async function loadSentry(): Promise<SentryLike | null> {
  if (state.sentry) return state.sentry;
  // Dynamic import so missing @sentry/* doesn't break the build.
  const candidates = ['@sentry/nextjs', '@sentry/react', '@sentry/browser'];
  for (const pkg of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ pkg);
      if (mod?.init && mod?.captureException) {
        state.sentry = mod as SentryLike;
        return state.sentry;
      }
    } catch {
      // Module not installed — try the next candidate.
    }
  }
  return null;
}

export interface OwnerWebSentryConfig {
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
}

/**
 * Initialise Sentry for owner-web. Idempotent — safe to call from
 * `app/layout.tsx` on every mount.
 */
export async function initOwnerWebSentry(
  config: OwnerWebSentryConfig = {},
): Promise<void> {
  const dsn = config.dsn ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
  if (!dsn) {
    state.logger.info('owner-web Sentry disabled — no DSN configured');
    return;
  }
  const sentry = await loadSentry();
  if (!sentry) {
    state.logger.info(
      'owner-web Sentry disabled — @sentry/* package not installed',
    );
    return;
  }
  sentry.init({
    dsn,
    environment: config.environment ?? process.env.NODE_ENV ?? 'production',
    release: config.release ?? process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: resolvePilotSampleRate(),
  });
  state.logger.info('owner-web Sentry initialised', {
    pilotSampleRate: resolvePilotSampleRate(),
  });
}

/**
 * Stamp the active pilot user. Call this from the auth context after
 * sign-in completes — every subsequent `captureError` will carry the
 * tag bundle.
 */
export function setPilotUser(id: string, cohort: string): void {
  const next: { id?: string; cohort?: string } = {};
  const cleanId = id.trim();
  const cleanCohort = cohort.trim();
  if (cleanId.length > 0) next.id = cleanId;
  if (cleanCohort.length > 0) next.cohort = cleanCohort;
  state.pilotUser = Object.freeze(next);
  if (state.sentry) {
    state.sentry.withScope((scope) => {
      scope.setUser({ id, cohort });
    });
  }
}

/**
 * Attach a session-replay correlation ID. Optional — only set when the
 * replay SDK has actually started recording (avoids fake IDs).
 */
export function setReplaySessionId(replaySessionId: string): void {
  const next: { id?: string; cohort?: string; replaySessionId?: string } = {
    ...(state.pilotUser.id ? { id: state.pilotUser.id } : {}),
    ...(state.pilotUser.cohort ? { cohort: state.pilotUser.cohort } : {})
  };
  const cleanReplay = replaySessionId.trim();
  if (cleanReplay.length > 0) next.replaySessionId = cleanReplay;
  state.pilotUser = Object.freeze(next);
}

function pilotContext() {
  const input: { pilotUserId?: string; pilotCohort?: string; replaySessionId?: string } = {};
  if (state.pilotUser.id) input.pilotUserId = state.pilotUser.id;
  if (state.pilotUser.cohort) input.pilotCohort = state.pilotUser.cohort;
  if (state.pilotUser.replaySessionId) input.replaySessionId = state.pilotUser.replaySessionId;
  return buildPilotEventContext(input);
}

/**
 * Capture an error. Always logs via pino (so the pilot-errors endpoint
 * can read it from the log sink) and additionally forwards to Sentry
 * when the SDK is loaded.
 */
export function captureError(err: unknown, ctx: CaptureContext = {}): void {
  const ctxBundle = pilotContext();
  const payload = {
    ...(ctx.tenantId && { tenantId: ctx.tenantId }),
    ...(ctx.userId && { userId: ctx.userId }),
    ...(ctx.route && { route: ctx.route }),
    pilotTags: ctxBundle.tags,
    pilotExtra: ctxBundle.extra,
    ...ctx.extra,
  };
  const message = err instanceof Error ? err.message : String(err);
  state.logger.error(message, err instanceof Error ? err : undefined, payload);

  if (!state.sentry) return;
  state.sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(ctxBundle.tags)) {
      if (v) scope.setTag(k, v);
    }
    for (const [k, v] of Object.entries(ctxBundle.extra)) {
      if (v !== undefined) scope.setExtra(k, v);
    }
    if (ctx.route) scope.setTag('route', ctx.route);
    if (ctx.tenantId) scope.setTag('tenantId', ctx.tenantId);
    state.sentry!.captureException(err);
  });
}

export type CaptureLevel = 'info' | 'warning' | 'error';

/**
 * Capture an informational / warning message. Same context-injection as
 * `captureError` so dashboards can pivot by cohort.
 */
export function captureMessage(
  msg: string,
  level: CaptureLevel = 'info',
  ctx: CaptureContext = {},
): void {
  const ctxBundle = pilotContext();
  const payload = {
    ...(ctx.tenantId && { tenantId: ctx.tenantId }),
    ...(ctx.userId && { userId: ctx.userId }),
    ...(ctx.route && { route: ctx.route }),
    pilotTags: ctxBundle.tags,
    pilotExtra: ctxBundle.extra,
    ...ctx.extra,
  };
  if (level === 'error') state.logger.error(msg, undefined, payload);
  else if (level === 'warning') state.logger.warn(msg, payload);
  else state.logger.info(msg, payload);

  if (!state.sentry) return;
  state.sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(ctxBundle.tags)) {
      if (v) scope.setTag(k, v);
    }
    state.sentry!.captureMessage(msg, level);
  });
}

/**
 * Lightweight transaction stub. When the real Sentry SDK is present we
 * return a sample-rate driven transaction; otherwise a no-op object so
 * callers can use `start()` / `end()` without conditionals.
 */
export interface PilotTransaction {
  readonly name: string;
  end(): void;
}

export function startTransaction(name: string): PilotTransaction {
  const startedAt = Date.now();
  return {
    name,
    end: () => {
      const durationMs = Date.now() - startedAt;
      state.logger.debug('owner-web transaction', { name, durationMs });
    },
  };
}
