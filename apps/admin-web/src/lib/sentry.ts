/**
 * Admin-web Sentry wrapper — pilot-mode aware.
 *
 * Mirrors `apps/owner-web/src/lib/sentry.ts` but stamps `service: 'admin-web'`
 * on every log line. The two web surfaces stay deliberately parallel so a
 * single doc patch updates both, and pilot dashboards can group by service.
 *
 * Behaviour
 * ─────────
 * - DSN + SDK present → forwards to Sentry with pilot tags attached.
 * - DSN missing / SDK absent → degrades to pino logging.
 *
 * Upgrade path
 * ────────────
 * Install `@sentry/react` or `@sentry/nextjs`, set `NEXT_PUBLIC_SENTRY_DSN`,
 * then call `initAdminWebSentry()` from `app/layout.tsx`.
 */

import {
  createLogger,
  buildPilotEventContext,
  resolvePilotSampleRate,
  type Logger,
} from '@borjie/observability';

const SERVICE_NAME = 'admin-web';

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
      // Try next candidate.
    }
  }
  return null;
}

export interface AdminWebSentryConfig {
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
}

export async function initAdminWebSentry(
  config: AdminWebSentryConfig = {},
): Promise<void> {
  const dsn = config.dsn ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
  if (!dsn) {
    state.logger.info('admin-web Sentry disabled — no DSN configured');
    return;
  }
  const sentry = await loadSentry();
  if (!sentry) {
    state.logger.info(
      'admin-web Sentry disabled — @sentry/* package not installed',
    );
    return;
  }
  sentry.init({
    dsn,
    environment: config.environment ?? process.env.NODE_ENV ?? 'production',
    release: config.release ?? process.env.NEXT_PUBLIC_GIT_SHA,
    tracesSampleRate: resolvePilotSampleRate(),
  });
  state.logger.info('admin-web Sentry initialised', {
    pilotSampleRate: resolvePilotSampleRate(),
  });
}

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
      state.logger.debug('admin-web transaction', { name, durationMs });
    },
  };
}
