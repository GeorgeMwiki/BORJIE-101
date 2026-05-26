/**
 * WhatsApp Business Cloud API ingest table (OMNI-P0-BATCH-2).
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md`.
 *
 * Drizzle types for the one table in migration
 * `0043_omni_p0_batch2.sql` owned by this connector:
 *
 *   - whatsappMessages → inbound + outbound message ledger.
 *                        UNIQUE on (tenant_id, waba_id, wa_message_id)
 *                        so Meta webhook retries are idempotent.
 *                        Tenant-scoped, RLS.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// whatsapp_messages
// ============================================================================

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** WhatsApp Business Account id (Meta). */
    wabaId: text('waba_id').notNull(),
    /** Per-WABA phone-number id (the routing key Meta uses). */
    phoneNumberId: text('phone_number_id').notNull(),
    /** Meta-issued message id; idempotency key for retries. */
    waMessageId: text('wa_message_id').notNull(),
    fromPhone: text('from_phone').notNull(),
    toPhone: text('to_phone').notNull(),
    /** 'inbound' | 'outbound'. CHECK in migration. */
    direction: text('direction').notNull(),
    /** text | image | video | audio | document | sticker | location | contacts | interactive | reaction | unknown */
    kind: text('kind').notNull(),
    /** Redacted text body (salted-hash applied when applicable). */
    text: text('text'),
    /** Normalised media projection — internal asset id, never the short-lived Meta URL. */
    media: jsonb('media'),
    /** Normalised vCard projection. */
    contacts: jsonb('contacts'),
    /** Original upstream payload — retained for legal hold + replay. */
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** SHA-256 audit anchor — cross-walks @borjie/audit-hash-chain. */
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantIngestedIdx: index('idx_whatsapp_messages_tenant_ingested').on(
      t.tenantId,
      t.ingestedAt,
    ),
    phoneIdx: index('idx_whatsapp_messages_phone').on(
      t.tenantId,
      t.phoneNumberId,
      t.ingestedAt,
    ),
    fromIdx: index('idx_whatsapp_messages_from').on(
      t.tenantId,
      t.fromPhone,
      t.ingestedAt,
    ),
    uniqTenantMsg: uniqueIndex('whatsapp_messages_tenant_uniq').on(
      t.tenantId,
      t.wabaId,
      t.waMessageId,
    ),
  }),
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;
