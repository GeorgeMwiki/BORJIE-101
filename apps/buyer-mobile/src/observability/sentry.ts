/**
 * Buyer-mobile Sentry wrapper — pilot-mode aware.
 *
 * Twin of `apps/workforce-mobile/src/observability/sentry.ts` — they
 * stay parallel by design so one doc patch updates both. The only
 * difference is `service: 'buyer-mobile'` on every log line and the
 * `screen` context-key naming.
 *
 * Upgrade path
 * ────────────
 * Install `@sentry/react-native`, set `EXPO_PUBLIC_SENTRY_DSN`, then
 * call `initBuyerMobileSentry()` from the app entry.
 */

import {
  createLogger,
  buildPilotEventContext,
  resolvePilotSampleRate,
  type Logger,
} from '@borjie/observability';

const SERVICE_NAME = 'buyer-mobile';

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
  readonly screen?: string;
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
      version: process.env.EXPO_PUBLIC_GIT_SHA ?? 'dev',
      environment: process.env.NODE_ENV ?? 'development',
    },
    logLevel: 'info',
    consoleExport: process.env.NODE_ENV !== 'production',
  } as never),
};

async function loadSentry(): Promise<SentryLike | null> {
  if (state.sentry) return state.sentry;
  const candidates = ['@sentry/react-native', '@sentry/react'];
  for (const pkg of candidates) {
    try {
      // Use require so Metro resolves at bundle time and tsc does not
      // require ES-module dynamic-import support under the current
      // tsconfig (strict + exactOptionalPropertyTypes).
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const mod: any = require(pkg);
      if (mod?.init && mod?.captureException) {
        state.sentry = mod as SentryLike;
        return state.sentry;
      }
    } catch {
      // Try next.
    }
  }
  return null;
}

export interface BuyerMobileSentryConfig {
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
}

export async function initBuyerMobileSentry(
  config: BuyerMobileSentryConfig = {},
): Promise<void> {
  const dsn = config.dsn ?? process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
  if (!dsn) {
    state.logger.info('buyer-mobile Sentry disabled — no DSN configured');
    return;
  }
  const sentry = await loadSentry();
  if (!sentry) {
    state.logger.info(
      'buyer-mobile Sentry disabled — @sentry/* package not installed',
    );
    return;
  }
  sentry.init({
    dsn,
    environment: config.environment ?? process.env.NODE_ENV ?? 'production',
    release: config.release ?? process.env.EXPO_PUBLIC_GIT_SHA,
    tracesSampleRate: resolvePilotSampleRate(),
  });
  state.logger.info('buyer-mobile Sentry initialised', {
    pilotSampleRate: resolvePilotSampleRate(),
  });
}

export function setPilotUser(id: string, cohort: string): void {
  state.pilotUser = Object.freeze({
    id: id.trim() || undefined,
    cohort: cohort.trim() || undefined,
  });
  if (state.sentry) {
    state.sentry.withScope((scope) => {
      scope.setUser({ id, cohort });
    });
  }
}

export function setReplaySessionId(replaySessionId: string): void {
  state.pilotUser = Object.freeze({
    ...state.pilotUser,
    replaySessionId: replaySessionId.trim() || undefined,
  });
}

function pilotContext() {
  return buildPilotEventContext({
    pilotUserId: state.pilotUser.id,
    pilotCohort: state.pilotUser.cohort,
    replaySessionId: state.pilotUser.replaySessionId,
  });
}

export function captureError(err: unknown, ctx: CaptureContext = {}): void {
  const ctxBundle = pilotContext();
  const payload = {
    ...(ctx.tenantId && { tenantId: ctx.tenantId }),
    ...(ctx.userId && { userId: ctx.userId }),
    ...(ctx.screen && { screen: ctx.screen }),
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
    if (ctx.screen) scope.setTag('screen', ctx.screen);
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
    ...(ctx.screen && { screen: ctx.screen }),
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
      state.logger.debug('buyer-mobile transaction', { name, durationMs });
    },
  };
}
