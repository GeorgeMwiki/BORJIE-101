/**
 * Sink selection — the composition-root decision for *where* fired
 * triggers go.
 *
 * Default is the real {@link createNotificationSink} so proactive triggers
 * actually reach users. When notifications are not configured (no Resend
 * key, or the host supplied no recipient resolver / dispatchers), the
 * selector falls back to {@link createLogSink} so dev and CI stay usable
 * without notification plumbing — exactly the pre-existing behaviour.
 *
 * Env is read ONCE here, at bootstrap, per the repo rule "no reading
 * process.env outside bootstrap". Everything downstream takes the resolved
 * config as an argument.
 */
import { z } from 'zod';
import type { ChannelDispatcher, FollowupChannel } from '@borjie/user-followup';
import type { TriggerSink, WorkerLogger } from '../types.js';
import { createLogSink } from './log-sink.js';
import {
  createNotificationSink,
  type RecipientResolver,
} from './notification-sink.js';

/**
 * Notification wiring the host provides when it wants real delivery. When
 * `undefined`, the selector falls back to the log sink regardless of env.
 */
export interface NotificationWiring {
  readonly resolveRecipient: RecipientResolver;
  readonly dispatchers: ReadonlyMap<FollowupChannel, ChannelDispatcher>;
}

export interface SelectSinkArgs {
  readonly logger: WorkerLogger;
  /** Real notification wiring; omit to force the log sink. */
  readonly notifications?: NotificationWiring;
  /**
   * Test seam — overrides the env read. Production leaves this unset and
   * the selector reads `process.env` once at bootstrap.
   */
  readonly env?: NodeJS.ProcessEnv;
}

const envSchema = z.object({
  /**
   * Master switch. `'1' | 'true'` enables the real notification sink;
   * anything else (or unset) keeps the log sink. Defaults to enabled when
   * notification wiring is present AND a Resend key exists.
   */
  PROACTIVE_TRIGGERS_NOTIFY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

function readNotifyConfig(env: NodeJS.ProcessEnv): {
  readonly explicitFlag: boolean | null;
  readonly hasResendKey: boolean;
} {
  const parsed = envSchema.safeParse({
    PROACTIVE_TRIGGERS_NOTIFY: env['PROACTIVE_TRIGGERS_NOTIFY'],
    RESEND_API_KEY: env['RESEND_API_KEY'],
  });
  const flagRaw = parsed.success
    ? parsed.data.PROACTIVE_TRIGGERS_NOTIFY
    : undefined;
  const explicitFlag =
    flagRaw === undefined
      ? null
      : flagRaw === '1' || flagRaw.toLowerCase() === 'true';
  const hasResendKey =
    parsed.success && (parsed.data.RESEND_API_KEY?.length ?? 0) >= 8;
  return { explicitFlag, hasResendKey };
}

/**
 * Pick the sink the worker should run with. Logs the decision so the
 * choice is observable in production.
 */
export function selectSink(args: SelectSinkArgs): TriggerSink {
  const env = args.env ?? process.env;
  const { explicitFlag, hasResendKey } = readNotifyConfig(env);

  // No wiring => can't deliver; always log.
  if (!args.notifications) {
    args.logger.info(
      { sink: 'log', reason: 'no_notification_wiring' },
      'proactive-triggers-worker: using log sink (no notification wiring)',
    );
    return createLogSink({ logger: args.logger });
  }

  // Explicit opt-out wins.
  if (explicitFlag === false) {
    args.logger.info(
      { sink: 'log', reason: 'disabled_by_env' },
      'proactive-triggers-worker: using log sink (PROACTIVE_TRIGGERS_NOTIFY disabled)',
    );
    return createLogSink({ logger: args.logger });
  }

  // Default-on when notifications are configured. Require a Resend key
  // unless the operator explicitly forced notify on (e.g. an in-app-only
  // deployment that does not use email at all).
  const enabled = explicitFlag === true || hasResendKey;
  if (!enabled) {
    args.logger.info(
      { sink: 'log', reason: 'notifications_unconfigured' },
      'proactive-triggers-worker: using log sink (no RESEND_API_KEY; set PROACTIVE_TRIGGERS_NOTIFY=1 to force)',
    );
    return createLogSink({ logger: args.logger });
  }

  args.logger.info(
    { sink: 'notification' },
    'proactive-triggers-worker: using real notification sink',
  );
  return createNotificationSink({
    logger: args.logger,
    resolveRecipient: args.notifications.resolveRecipient,
    dispatchers: args.notifications.dispatchers,
  });
}
