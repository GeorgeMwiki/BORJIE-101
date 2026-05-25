// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * Messaging Repository
 * PostgreSQL implementation for Conversation, Message, and Participant persistence
 */

import {
  eq,
  and,
  desc,
  isNull,
  count,
  sql,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  conversations,
  messages,
  conversationParticipants,
} from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';
import { buildPaginatedResult } from './base.repository.js';
import {
  decryptRow,
  decryptRows,
  encryptRow,
  type EncryptionPort,
  type FieldEncryptionAuditSink,
} from '../security/encryption/index.js';
import type { RepoEncryptionDeps } from './customer.repository.js';

const MESSAGES_TABLE = 'messages';

export class MessagingRepository {
  private readonly encPort: EncryptionPort | null;
  private readonly encAudit: FieldEncryptionAuditSink | null;

  constructor(private db: DatabaseClient, deps: RepoEncryptionDeps = {}) {
    this.encPort = deps.encPort ?? null;
    this.encAudit = deps.encAudit ?? null;
  }

  private async decryptMessagesMany<T extends Record<string, unknown>>(
    rows: T[],
    tenantId: string | null,
  ): Promise<T[]> {
    if (!this.encPort || rows.length === 0) return rows;
    return (await decryptRows(rows, {
      table: MESSAGES_TABLE,
      tenantId,
      port: this.encPort,
    })) as T[];
  }

  async createConversation(data: typeof conversations.$inferInsert) {
    const [row] = await this.db.insert(conversations).values(data).returning();
    return row!;
  }

  async getConversation(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)));
    return rows[0] ?? null;
  }

  async getConversations(
    tenantId: TenantId,
    options?: { type?: string; status?: string; limit?: number; offset?: number }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(conversations.tenantId, tenantId)];

    if (options?.type) {
      conditions.push(eq(conversations.type, options.type));
    }
    if (options?.status) {
      conditions.push(eq(conversations.status, options.status));
    }

    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(conversations)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async createMessage(data: typeof messages.$inferInsert) {
    const tenantIdForCrypto = (data as Record<string, unknown>).tenantId as string | undefined;
    const encryptedInput = this.encPort
      ? await encryptRow({
          row: { ...data },
          table: MESSAGES_TABLE,
          tenantId: tenantIdForCrypto ?? null,
          rowId: (data as Record<string, unknown>).id ? String((data as Record<string, unknown>).id) : null,
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : data;
    const [row] = await this.db.insert(messages).values(encryptedInput).returning();
    if (!row || !this.encPort) return row!;
    return (await decryptRow({
      row,
      table: MESSAGES_TABLE,
      tenantId: tenantIdForCrypto ?? null,
      port: this.encPort,
    })) as typeof row;
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; offset?: number; tenantId?: TenantId | string | null }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);
    const tid = options?.tenantId ?? null;
    return this.decryptMessagesMany(rows, tid !== null ? String(tid) : null);
  }

  async markAsRead(
    conversationId: string,
    participant: { userId?: string; customerId?: string }
  ) {
    const conditions = [eq(conversationParticipants.conversationId, conversationId)];
    if (participant.userId) {
      conditions.push(eq(conversationParticipants.userId, participant.userId));
    } else if (participant.customerId) {
      conditions.push(eq(conversationParticipants.customerId, participant.customerId));
    } else {
      return null;
    }
    const [row] = await this.db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(...conditions, isNull(conversationParticipants.leftAt)))
      .returning();
    return row ?? null;
  }

  async addParticipant(data: typeof conversationParticipants.$inferInsert) {
    const [row] = await this.db
      .insert(conversationParticipants)
      .values(data)
      .returning();
    return row!;
  }

  async removeParticipant(
    conversationId: string,
    participant: { userId?: string; customerId?: string }
  ) {
    const conditions = [eq(conversationParticipants.conversationId, conversationId)];
    if (participant.userId) {
      conditions.push(eq(conversationParticipants.userId, participant.userId));
    } else if (participant.customerId) {
      conditions.push(eq(conversationParticipants.customerId, participant.customerId));
    } else {
      return null;
    }
    const [row] = await this.db
      .update(conversationParticipants)
      .set({ leftAt: new Date() })
      .where(and(...conditions))
      .returning();
    return row ?? null;
  }

  async getUnreadCount(
    participant: { userId?: string; customerId?: string },
    tenantId: TenantId
  ) {
    const participantConditions = [
      eq(conversationParticipants.conversationId, messages.conversationId),
      isNull(conversationParticipants.leftAt),
    ];
    if (participant.userId) {
      participantConditions.push(eq(conversationParticipants.userId, participant.userId));
    } else if (participant.customerId) {
      participantConditions.push(eq(conversationParticipants.customerId, participant.customerId));
    } else {
      return 0;
    }
    const result = await this.db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .innerJoin(
        conversationParticipants,
        and(...participantConditions)
      )
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          isNull(messages.deletedAt),
          sql`${messages.createdAt} > COALESCE(${conversationParticipants.lastReadAt}, '1970-01-01'::timestamptz)`
        )
      );
    return Number(result[0]?.count ?? 0);
  }
}
