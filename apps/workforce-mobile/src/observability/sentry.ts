/**
 * Workforce-mobile Sentry wrapper — pilot-mode aware.
 *
 * Expo / React-Native flavour of the same shape used by `owner-web` and
 * `admin-web`. Reads `EXPO_PUBLIC_BORJIE_PILOT_MODE` for pilot detection
 * (the env helper in `@borjie/observability` walks all three prefix
 * variants) and `EXPO_PUBLIC_SENTRY_DSN` for the DSN.
 *
 * Behaviour
 * ─────────
 * - DSN + `@sentry/react-native` installed → forwards events to Sentry
 *   with pilot tags attached.
 * - DSN missing / SDK absent → degrades to structured pino logging.
 *
 * Upgrade path
 * ────────────
 * Install `@sentry/react-native`, set `EXPO_PUBLIC_SENTRY_DSN`, then
 * call `initWorkforceMobileSentry()` from the app entry. Until then,
 * `captureError` is safe to call from anywhere — errors land in the
 * platform log sink so the pilot-errors endpoint can serve them.
 */

/**
 * Local fallback shims for `@borjie/observability`.
 *
 * `@borjie/observability` is a Node-targeted package (pino + audit
 * pipeline) and is intentionally NOT a runtime dep of this Expo app.
 * The shapes below mirror just the surface area this wrapper uses so
 * the file typechecks and degrades to console logging when the full
 * package is unavailable on-device.
 */
interface Logger {
  info: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
  warn: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
  error: (
    msg: string,
    err?: Error,
    ctx?: Readonly<Record<string, unknown>>,
  ) => void;
  debug: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
}

interface PilotEventContext {
  readonly tags: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, string>>;
  readonly tracesSampleRate: number;
}

function createLogger(_config: unknown): Logger {
  // eslint-disable-next-line no-console
  const sink = (level: 'info' | 'warn' | 'error' | 'debug') =>
    (msg: string, ...rest: unknown[]): void => {
      // Console is the only universally-available sink on-device until
      // a real transport (pino-react-native, Sentry) is wired in.
      // eslint-disable-next-line no-console
      (console[level] ?? console.log)(`[workforce-mobile] ${msg}`, ...rest);
    };
  return Object.freeze({
    info: sink('info'),
    warn: sink('warn'),
    error: (msg: string, err?: Error, ctx?: Readonly<Record<string, unknown>>) => {
      // eslint-disable-next-line no-console
      console.error(`[workforce-mobile] ${msg}`, err, ctx);
    },
    debug: sink('debug'),
  });
}

function isPilotMode(): boolean {
  const flag =
    process.env.EXPO_PUBLIC_BORJIE_PILOT_MODE ??
    process.env.BORJIE_PILOT_MODE ??
    '';
  return flag === '1' || flag.toLowerCase() === 'true';
}

function buildPilotEventContext(input: {
  readonly pilotUserId?: string;
  readonly pilotCohort?: string;
  readonly replaySessionId?: string;
}): PilotEventContext {
  const enabled = isPilotMode();
  if (!enabled) {
    return Object.freeze({
      tags: Object.freeze({}),
      extra: Object.freeze({}),
      tracesSampleRate: 0.1,
    });
  }
  const tags: Record<string, string> = { pilot_mode: 'true' };
  if (input.pilotUserId) tags.pilot_user_id = input.pilotUserId;
  if (input.pilotCohort) tags.pilot_cohort = input.pilotCohort;
  const extra: Record<string, string> = {};
  if (input.replaySessionId) extra.replay_session_id = input.replaySessionId;
  return Object.freeze({
    tags: Object.freeze(tags),
    extra: Object.freeze(extra),
    tracesSampleRate: 1.0,
  });
}

function resolvePilotSampleRate(): number {
  return isPilotMode() ? 1.0 : 0.1;
}

const SERVICE_NAME = 'workforce-mobile';

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
  // React-Native first, fall back to plain @sentry/react if someone is
  // running this on the Expo Web target.
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

export interface WorkforceMobileSentryConfig {
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
}

export async function initWorkforceMobileSentry(
  config: WorkforceMobileSentryConfig = {},
): Promise<void> {
  const dsn = config.dsn ?? process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
  if (!dsn) {
    state.logger.info('workforce-mobile Sentry disabled — no DSN configured');
    return;
  }
  const sentry = await loadSentry();
  if (!sentry) {
    state.logger.info(
      'workforce-mobile Sentry disabled — @sentry/* package not installed',
    );
    return;
  }
  sentry.init({
    dsn,
    environment: config.environment ?? process.env.NODE_ENV ?? 'production',
    release: config.release ?? process.env.EXPO_PUBLIC_GIT_SHA,
    tracesSampleRate: resolvePilotSampleRate(),
  });
  state.logger.info('workforce-mobile Sentry initialised', {
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
  const ctx: { pilotUserId?: string; pilotCohort?: string; replaySessionId?: string } = {};
  if (state.pilotUser.id) ctx.pilotUserId = state.pilotUser.id;
  if (state.pilotUser.cohort) ctx.pilotCohort = state.pilotUser.cohort;
  if (state.pilotUser.replaySessionId) ctx.replaySessionId = state.pilotUser.replaySessionId;
  return buildPilotEventContext(ctx);
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
      state.logger.debug('workforce-mobile transaction', { name, durationMs });
    },
  };
}
