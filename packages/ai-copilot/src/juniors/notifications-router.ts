/**
 * Notifications Router — push + SMS + WhatsApp dispatch with per-
 * category mute (BORJIE owner experience).
 *
 * The LLM here is a router: it decides which channels to fire and
 * composes Swahili-first message variants. The actual dispatch is
 * performed by adapter tools (sms_send, whatsapp_send, push_send) wired
 * by the orchestrator.
 *
 * Schema gap: `notifications_outbox` raw SQL; TODO(#30).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  deterministicId,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const NotificationCategory = z.enum([
  'licence_renewal',
  'safety_alert',
  'csr_meeting',
  'sales_status',
  'fx_alert',
  'inventory_alert',
  'audit_outcome',
  'community_grievance',
  'dormancy_alert',
  'cliff_reminder',
  'system',
]);

export const Channel = z.enum(['push', 'sms', 'whatsapp', 'email', 'voice']);

export const NotificationsRouterInputSchema = z.object({
  tenantId: z.string().min(1),
  recipient_user_id: z.string().min(1),
  recipient_phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
  recipient_locale: z.enum(['sw', 'en']).default('sw'),
  category: NotificationCategory,
  severity: z.enum(['info', 'warning', 'critical']),
  subject: z.string().min(1),
  body_long: z.string().min(1),
  muted_categories: z.array(NotificationCategory).default([]),
  available_channels: z.array(Channel).min(1),
  reply_callback_id: z.string().optional(),
});
export type NotificationsRouterInput = z.infer<typeof NotificationsRouterInputSchema>;

export const NotificationsRouterOutput = AuditedOutputBase.extend({
  notification_id: z.string().min(1),
  dispatched_channels: z.array(
    z.object({
      channel: Channel,
      composed_message: z.string().min(1),
      language: z.enum(['sw', 'en']),
      length_chars: z.number().int().positive(),
    }),
  ),
  suppressed_reason: z.string().nullable(),
});
export type NotificationsRouterOutput = z.infer<typeof NotificationsRouterOutput>;

export const NOTIFICATIONS_ROUTER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Notifications Router',
  mandate:
    'Pick the right channels (push / sms / whatsapp / email / voice) and compose Swahili-first variants per channel. Respect per-category mute lists.',
  tools: 'sms_send, whatsapp_send, push_send, email_send, voice_call.',
  evidence:
    'Cite the originating recommendation_id for every notification. For safety_alert / cliff_reminder / dormancy_alert, fire SMS + WhatsApp even if push is muted.',
  outputSchema:
    '{ "notification_id": string, "dispatched_channels": [{ channel, composed_message, language, length_chars }], ' +
    '"suppressed_reason": string|null, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'fan-out + composition; never dials voice for severity=info',
  hardRules: [
    'Never bypass a muted category unless severity === "critical" AND category in {safety_alert, dormancy_alert, cliff_reminder}.',
    'SMS body must fit one segment (<=160 chars GSM-7) when possible; truncate with " — open Borjie" link if longer.',
    'WhatsApp message uses approved template when category in {licence_renewal, csr_meeting, audit_outcome}.',
    'Default language is recipient_locale; Swahili-first when sw.',
  ],
});

function buildUserPrompt(input: NotificationsRouterInput): string {
  return [
    `TENANT: ${input.tenantId}  RECIPIENT: ${input.recipient_user_id}  LOCALE: ${input.recipient_locale}`,
    `CATEGORY: ${input.category}  SEVERITY: ${input.severity}`,
    `MUTED: ${JSON.stringify(input.muted_categories)}  AVAILABLE: ${JSON.stringify(input.available_channels)}`,
    `SUBJECT: ${input.subject}`,
    `BODY_LONG:`,
    `"""`,
    input.body_long.slice(0, 1_500),
    `"""`,
  ].join('\n');
}

export function createNotificationsRouter(deps: JuniorDeps) {
  return {
    async processInput(input: NotificationsRouterInput): Promise<NotificationsRouterOutput> {
      const validated = NotificationsRouterInputSchema.parse(input);
      const notificationId = deterministicId(
        'ntf',
        validated.tenantId,
        validated.recipient_user_id,
        validated.category,
        String(Date.now()),
      );
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'notifications-router',
        schema: NotificationsRouterOutput,
        systemPrompt: NOTIFICATIONS_ROUTER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated) + `\nPRE-ASSIGNED notification_id: ${notificationId}`,
        maxTokens: 1500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `notifications_outbox`.
          await deps.db.execute(
            sql`INSERT INTO notifications_outbox
                  (id, tenant_id, recipient_user_id, category, severity, summary, created_at)
                VALUES (${output.notification_id}, ${validated.tenantId}, ${validated.recipient_user_id},
                        ${validated.category}, ${validated.severity}, ${summary}::jsonb, NOW())
                ON CONFLICT (id) DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('notifications-router: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type NotificationsRouter = ReturnType<typeof createNotificationsRouter>;

export function createDefaultNotificationsRouter(): NotificationsRouter {
  let cached: NotificationsRouter | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createNotificationsRouter(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
