/**
 * Reminder action handlers — the first REAL side-effecting verbs the
 * cockpit chat can execute.
 *
 * Both handlers write the canonical owner `reminders` table (the same
 * one backing `/api/v1/owner/reminders` + the reminders-dispatch worker
 * — see owner-reminders.schema.ts). They reuse that route's exact
 * insert / update shape so a chat-created reminder is indistinguishable
 * from a form-created one downstream.
 *
 * Tenant scoping: callers MUST bind `app.current_tenant_id` on the
 * connection before dispatch — `databaseMiddleware` does this for the
 * HTTP routes, and the brain-teach auto-execute path binds it via a
 * `SET LOCAL` inside its own transaction. RLS then clips every write to
 * the caller's tenant. Reads/updates ALSO constrain by `tenant_id` +
 * `owner_id` as belt-and-braces (matching the canonical
 * `/owner/reminders` route) so a stale/missing GUC can never surface
 * another tenant's row.
 *
 * SAFE-by-construction: reminders are non-money, non-regulator calendar
 * items. Money / ledger / hire / licence verbs are out of scope and are
 * NOT registered (see ../registry.ts).
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { reminders, REMINDER_CHANNELS } from '@borjie/database';
import {
  resolveOwnerContact,
  type OwnerIdentityResolverDb,
  type ResolvedOwnerContact,
} from '../../owner-identity/resolver.js';

import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

/** Channels the reminders-dispatch worker can actually deliver. */
type DeliverableReminderChannel = 'email' | 'sms' | 'slack';

/**
 * Map an owner contact channel to the deliverable reminder channel it backs,
 * IFF that channel has a resolvable destination on the contact. Returns null
 * when the channel is undeliverable or one the worker cannot send
 * (whatsapp / calendar). Pure.
 */
function deliverableFor(
  channel: string,
  contact: ResolvedOwnerContact,
): DeliverableReminderChannel | null {
  if (channel === 'email') return contact.email ? 'email' : null;
  if (channel === 'sms') return contact.phone ? 'sms' : null;
  if (channel === 'slack') return contact.slackHandle ? 'slack' : null;
  // 'whatsapp' / 'calendar' / anything else: the dispatch worker cannot deliver.
  return null;
}

/**
 * Pick a DELIVERABLE reminder channel for the owner so a chat/tab-created
 * reminder is never scheduled on a channel with no destination (which the
 * dispatch worker would terminally fail).
 *
 * GENERATIVE ordering: first honour the owner's ORDERED `channelPriority` list
 * (highest-priority first) and return the FIRST entry with a resolvable
 * destination. If none of the ranked channels is deliverable (or the list is
 * empty), fall back to the legacy `preferredChannel` → email → sms → slack
 * logic, then `email` (the worker logs the missing-address failure clearly).
 * Pure.
 */
export function pickDeliverableChannel(
  contact: ResolvedOwnerContact,
): DeliverableReminderChannel {
  // 1) Owner's explicit ranking wins, in order — first deliverable entry.
  for (const channel of contact.channelPriority) {
    const deliverable = deliverableFor(channel, contact);
    if (deliverable) return deliverable;
  }

  // 2) Fall back to the single preferred channel when it has a destination.
  const canEmail = Boolean(contact.email);
  const canSms = Boolean(contact.phone);
  const canSlack = Boolean(contact.slackHandle);
  const pref = contact.preferredChannel;
  if (pref === 'email' && canEmail) return 'email';
  if (pref === 'sms' && canSms) return 'sms';
  if (pref === 'slack' && canSlack) return 'slack';

  // 3) preferred channel unset / undeliverable (incl. 'whatsapp', not a worker
  // channel) → first channel with a real destination.
  if (canEmail) return 'email';
  if (canSms) return 'sms';
  if (canSlack) return 'slack';
  return 'email';
}

/**
 * Resolve the channel for a new reminder. An EXPLICIT caller channel wins
 * verbatim (the owner picked it). When absent (the common chat/tab case), the
 * owner's deliverable channel is resolved from `owner_contact_prefs` so the
 * reminder actually reaches them. NEVER throws — a resolver fault falls back to
 * `email` (the prior default), so a contact-prefs read error can never drop the
 * reminder write itself.
 */
async function resolveReminderChannel(
  ctx: ExecContext,
  explicit: (typeof REMINDER_CHANNELS)[number] | undefined,
): Promise<(typeof REMINDER_CHANNELS)[number]> {
  if (explicit) return explicit;
  try {
    const contact = await resolveOwnerContact(
      ctx.db as unknown as OwnerIdentityResolverDb,
      { tenantId: ctx.tenantId, ownerId: ctx.userId },
    );
    return pickDeliverableChannel(contact);
  } catch (err) {
    ctx.logger.warn?.(
      {
        executor: 'set_reminder',
        tenantId: ctx.tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'action-executor: owner-contact resolve failed — defaulting reminder channel to email',
    );
    return 'email';
  }
}

// ─── set_reminder ────────────────────────────────────────────────────

/**
 * Either an absolute `dueAt` ISO timestamp OR a relative `dueInDays`
 * offset (1–730). Exactly one is required; both-or-neither is rejected
 * so the resolved trigger time is never ambiguous.
 */
const setReminderSchema = z
  .object({
    title: z.string().min(1).max(280),
    body: z.string().min(1).max(8000).optional(),
    dueInDays: z.number().int().min(1).max(730).optional(),
    dueAt: z
      .string()
      .datetime({ offset: true })
      .refine(
        (s) => Number.isFinite(new Date(s).getTime()),
        'dueAt must be a valid ISO-8601 timestamp',
      )
      .optional(),
    // OPTIONAL — an explicit caller channel wins; when absent the handler
    // resolves the owner's DELIVERABLE channel from owner_contact_prefs so the
    // reminder is never scheduled on a dead destination (see
    // resolveReminderChannel). No `.default('email')`: that hid the
    // "no channel chosen" case behind a possibly-undeliverable email.
    channel: z.enum(REMINDER_CHANNELS).optional(),
  })
  .refine((d) => Boolean(d.dueInDays) !== Boolean(d.dueAt), {
    message: 'provide exactly one of dueInDays or dueAt',
    path: ['dueInDays'],
  });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveTriggerAt(input: {
  readonly dueInDays?: number | undefined;
  readonly dueAt?: string | undefined;
}): Date {
  if (input.dueAt) return new Date(input.dueAt);
  // dueInDays is guaranteed present by the schema refinement when dueAt
  // is absent.
  return new Date(Date.now() + (input.dueInDays ?? 1) * MS_PER_DAY);
}

/**
 * Insert a new owner reminder. Mirrors the POST /owner/reminders insert:
 * same columns, same future-trigger guard, same idempotency-key
 * derivation so the dispatch worker's UNIQUE(tenant_id, idempotency_key)
 * is satisfied.
 */
export const setReminderHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = setReminderSchema.parse(rawInput);
  const triggerAt = resolveTriggerAt(input);
  if (!Number.isFinite(triggerAt.getTime()) || triggerAt.getTime() <= Date.now()) {
    throw new Error('reminder trigger time must be a valid future timestamp');
  }

  // Resolve a DELIVERABLE channel — explicit caller channel wins; otherwise the
  // owner's preferred/deliverable channel from owner_contact_prefs, so the
  // reminder is never scheduled on a dead destination.
  const channel = await resolveReminderChannel(ctx, input.channel);

  const idempotencyKey = `reminder-${ctx.userId}-${triggerAt.getTime()}-${randomUUID().slice(0, 8)}`;

  const inserted = await ctx.db
    .insert(reminders)
    .values({
      tenantId: ctx.tenantId,
      ownerId: ctx.userId,
      title: input.title,
      body: input.body ?? input.title,
      triggerAt,
      channel,
      status: 'scheduled',
      payload: {},
      idempotencyKey,
      // Chat-as-OS provenance: this row originated from the chat surface.
      // Object shape per ProvenanceJson ({via, actorId, requestedAt, ...}).
      provenance: {
        via: 'chat',
        actorId: ctx.userId,
        requestedAt: new Date().toISOString(),
      },
    })
    .returning({ id: reminders.id, triggerAt: reminders.triggerAt });

  const row = inserted[0];
  if (!row) {
    throw new Error('reminder insert returned no row');
  }

  ctx.logger.info?.(
    {
      executor: 'set_reminder',
      tenantId: ctx.tenantId,
      reminderId: row.id,
      triggerAt: triggerAt.toISOString(),
    },
    'action-executor: reminder created',
  );

  return {
    kind: 'reminder',
    id: String(row.id),
    summary: `Reminder "${input.title}" set for ${triggerAt.toISOString()}`,
    data: {
      reminderId: String(row.id),
      title: input.title,
      triggerAt: triggerAt.toISOString(),
      channel,
    },
  };
};

// ─── snooze_reminder ─────────────────────────────────────────────────

const snoozeReminderSchema = z.object({
  reminderId: z.string().uuid(),
  days: z.number().int().min(1).max(730),
});

/**
 * Push an existing reminder's trigger forward by `days`. Only a
 * `scheduled` reminder owned by the caller can be snoozed — a sent /
 * cancelled / failed reminder is immutable (matches the PATCH route's
 * IMMUTABLE_STATUS guard). The new trigger is computed from the existing
 * trigger so repeated snoozes compound predictably.
 */
export const snoozeReminderHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = snoozeReminderSchema.parse(rawInput);

  const existingRows = await ctx.db
    .select({
      id: reminders.id,
      status: reminders.status,
      triggerAt: reminders.triggerAt,
    })
    .from(reminders)
    .where(
      and(
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.ownerId, ctx.userId),
        eq(reminders.id, input.reminderId),
      ),
    )
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new Error(`reminder ${input.reminderId} not found`);
  }
  if (existing.status !== 'scheduled') {
    throw new Error(`cannot snooze a ${existing.status} reminder`);
  }

  const base = existing.triggerAt instanceof Date
    ? existing.triggerAt.getTime()
    : new Date(existing.triggerAt as unknown as string).getTime();
  const nextTrigger = new Date(base + input.days * MS_PER_DAY);

  const updated = await ctx.db
    .update(reminders)
    .set({ triggerAt: nextTrigger })
    .where(
      and(
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.ownerId, ctx.userId),
        eq(reminders.id, input.reminderId),
        eq(reminders.status, 'scheduled'),
      ),
    )
    .returning({ id: reminders.id, triggerAt: reminders.triggerAt });

  const row = updated[0];
  if (!row) {
    throw new Error(`reminder ${input.reminderId} could not be snoozed`);
  }

  ctx.logger.info?.(
    {
      executor: 'snooze_reminder',
      tenantId: ctx.tenantId,
      reminderId: row.id,
      days: input.days,
      triggerAt: nextTrigger.toISOString(),
    },
    'action-executor: reminder snoozed',
  );

  return {
    kind: 'reminder',
    id: String(row.id),
    summary: `Reminder snoozed ${input.days} day(s) to ${nextTrigger.toISOString()}`,
    data: {
      reminderId: String(row.id),
      days: input.days,
      triggerAt: nextTrigger.toISOString(),
    },
  };
};
