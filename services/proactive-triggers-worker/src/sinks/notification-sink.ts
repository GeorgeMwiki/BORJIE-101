/**
 * Real trigger sink — turns a fired proactive trigger into an actual
 * user-facing notification.
 *
 * The log-sink ({@link ../sinks/log-sink.ts}) only writes a Pino line —
 * nobody is nudged. This sink resolves the recipient (contact + locale +
 * channel preference), routes the nudge through the recipient's preferred
 * channel using the same fallback policy as `@borjie/user-followup`'s
 * scheduler (`preferred -> email -> inapp`), and dispatches via an
 * injected {@link ChannelDispatcher} keyed by {@link FollowupChannel}.
 *
 * Design constraints honoured:
 *   - Wire-agnostic: the recipient resolver and the per-channel
 *     dispatchers are injected. The composition root binds the real
 *     email dispatcher (Resend, via `@borjie/notifications`).
 *   - Idempotency: the trigger's stable `id` is threaded through as the
 *     dispatch idempotency key so the same nudge is never double-sent
 *     even if a sweep retries.
 *   - Locale purity: the recipient's stored locale (`sw` | `en`) drives
 *     the rendered language; no mixing.
 *   - Immutable: nothing is mutated; every object is constructed fresh.
 *   - Pino only: all logging goes through the injected WorkerLogger.
 */
import { z } from 'zod';
import type {
  ChannelDispatcher,
  FollowupCandidate,
  FollowupChannel,
} from '@borjie/user-followup';
import type { Role, Trigger } from '@borjie/user-context-store';
import type { TriggerSink, WorkerLogger } from '../types.js';

/**
 * Resolved contact + delivery preferences for a single recipient. The
 * fired trigger carries only `{ tenantId, userId, role }`; everything
 * needed to actually deliver a notification (address, language, allowed
 * channels) is resolved here against the host's user directory.
 */
export interface NotificationRecipient {
  /** Destination address for the email channel (and WhatsApp number etc.). */
  readonly email: string;
  /** Active locale — drives the rendered language. */
  readonly locale: 'sw' | 'en';
  /** Channels the user has opted into, most-preferred first. */
  readonly allowedChannels: ReadonlyArray<FollowupChannel>;
  /** Optional explicit preferred channel (defaults to the first allowed). */
  readonly preferredChannel?: FollowupChannel;
}

/**
 * Port the sink uses to turn `(tenantId, userId)` into a deliverable
 * recipient. Real implementations query the user directory; tests pass
 * an in-memory map. Returning `null` means "no deliverable contact" —
 * the sink then suppresses (and logs) rather than throwing.
 */
export interface RecipientResolver {
  resolve(
    tenantId: string,
    userId: string,
  ): Promise<NotificationRecipient | null>;
}

export interface CreateNotificationSinkArgs {
  readonly logger: WorkerLogger;
  readonly resolveRecipient: RecipientResolver;
  /** Concrete per-channel dispatchers. Missing channels are skipped. */
  readonly dispatchers: ReadonlyMap<FollowupChannel, ChannelDispatcher>;
}

/** Validates the injected recipient at the trust boundary. */
const recipientSchema = z.object({
  email: z.string().email(),
  locale: z.enum(['sw', 'en']),
  allowedChannels: z.array(z.enum(['inapp', 'email', 'whatsapp'])).min(1),
  preferredChannel: z.enum(['inapp', 'email', 'whatsapp']).optional(),
});

/**
 * Pick the dispatchable channel. Mirrors `@borjie/user-followup`'s
 * `resolveChannel`: honour the preferred channel when allowed, else fall
 * back to email, then in-app. Returns `null` when nothing is allowed.
 */
function pickChannel(
  recipient: NotificationRecipient,
): FollowupChannel | null {
  const allowed = new Set(recipient.allowedChannels);
  const preferred = recipient.preferredChannel ?? recipient.allowedChannels[0];
  if (preferred && allowed.has(preferred)) return preferred;
  if (allowed.has('email')) return 'email';
  if (allowed.has('inapp')) return 'inapp';
  if (allowed.has('whatsapp')) return 'whatsapp';
  return null;
}

/**
 * Map a fired trigger onto a `FollowupCandidate` so it can flow through
 * the same channel-dispatcher contract the daily-followup scheduler uses.
 * Pure: derives a fresh candidate, mutating nothing.
 */
function toCandidate(args: {
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: FollowupChannel;
  readonly trigger: Trigger;
  readonly nowIso: string;
}): FollowupCandidate {
  const { tenantId, userId, channel, trigger, nowIso } = args;
  // urgency 1..5 -> priority 0..1 (so the dispatcher can rank/colour).
  const priority = Math.min(1, Math.max(0, trigger.urgency / 5));
  return {
    // Trigger id is the stable idempotency key for the dispatch.
    id: trigger.id,
    tenant_id: tenantId,
    user_id: userId,
    source: 'user_flag',
    payload: {
      text: `${trigger.summary} — ${trigger.suggestedAction}`,
      action: {
        kind: 'review',
        label: trigger.suggestedAction,
      },
    },
    priority,
    channel,
    scheduled_for: nowIso,
    status: 'pending',
    sent_at: null,
    // The sink does not own the audit chain; the dispatcher records its
    // own delivery audit. Empty string keeps the candidate well-formed.
    audit_hash: '',
    created_at: nowIso,
    // Proactive triggers fire only at urgency >= minUrgency (default 4);
    // treat the top band as critical so quiet-hours/daily-cap can bypass
    // downstream if the dispatcher honours it.
    critical: trigger.urgency >= 5,
  };
}

/**
 * Build a real {@link TriggerSink} that delivers fired triggers to users.
 */
export function createNotificationSink(
  args: CreateNotificationSinkArgs,
): TriggerSink {
  const { logger, resolveRecipient, dispatchers } = args;

  return {
    async emit({
      tenantId,
      userId,
      role,
      trigger,
    }: {
      tenantId: string;
      userId: string;
      role: Role;
      trigger: Trigger;
    }): Promise<void> {
      const base = {
        tenantId,
        userId,
        role,
        triggerId: trigger.id,
        kind: trigger.kind,
        urgency: trigger.urgency,
      };

      let resolved: NotificationRecipient | null;
      try {
        resolved = await resolveRecipient.resolve(tenantId, userId);
      } catch (error) {
        logger.warn(
          { ...base, err: errMsg(error) },
          'proactive-triggers-worker: recipient resolve failed — trigger suppressed',
        );
        return;
      }

      if (!resolved) {
        logger.warn(
          base,
          'proactive-triggers-worker: no deliverable recipient — trigger suppressed',
        );
        return;
      }

      const parsed = recipientSchema.safeParse(resolved);
      if (!parsed.success) {
        logger.warn(
          { ...base, issues: parsed.error.issues.map((i) => i.message) },
          'proactive-triggers-worker: recipient failed validation — trigger suppressed',
        );
        return;
      }
      // Rebuild to satisfy exactOptionalPropertyTypes (zod yields the
      // optional field as `T | undefined`, which the target type rejects).
      const recipient: NotificationRecipient = {
        email: parsed.data.email,
        locale: parsed.data.locale,
        allowedChannels: parsed.data.allowedChannels,
        ...(parsed.data.preferredChannel
          ? { preferredChannel: parsed.data.preferredChannel }
          : {}),
      };

      const channel = pickChannel(recipient);
      if (channel === null) {
        logger.warn(
          base,
          'proactive-triggers-worker: recipient allows no channel — trigger suppressed',
        );
        return;
      }

      const dispatcher = dispatchers.get(channel);
      if (!dispatcher) {
        logger.warn(
          { ...base, channel },
          'proactive-triggers-worker: no dispatcher for channel — trigger suppressed',
        );
        return;
      }

      const candidate = toCandidate({
        tenantId,
        userId,
        channel,
        trigger,
        nowIso: new Date().toISOString(),
      });

      try {
        const result = await dispatcher.dispatch(candidate);
        if (result.delivered) {
          logger.info(
            { ...base, channel, deliveredAt: result.delivered_at },
            'proactive-triggers-worker: trigger delivered',
          );
        } else {
          logger.warn(
            { ...base, channel, err: result.error ?? 'undelivered' },
            'proactive-triggers-worker: dispatcher reported non-delivery',
          );
        }
      } catch (error) {
        logger.warn(
          { ...base, channel, err: errMsg(error) },
          'proactive-triggers-worker: dispatch threw — trigger dropped',
        );
      }
    },
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
