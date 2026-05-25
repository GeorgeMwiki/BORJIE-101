import { randomHex } from '../common/id-generator.js';
/**
 * Messaging/Chat Service
 *
 * Handles tenant-scoped conversations for support, maintenance, general,
 * lease, and payment topics. Supports real-time delivery via WebSocket.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type ConversationType =
  | 'support'
  | 'maintenance'
  | 'general'
  | 'lease'
  | 'payment';

export type MessageStatus = 'sent' | 'delivered' | 'read';

export type ConversationStatus = 'open' | 'closed';

export interface Participant {
  readonly userId: UserId;
  readonly role: 'owner' | 'member' | 'assistant';
  readonly joinedAt: ISOTimestamp;
  readonly lastReadAt: ISOTimestamp | null;
}

export interface MessageAttachment {
  readonly id: string;
  readonly url: string;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface Conversation {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: ConversationType;
  readonly participants: readonly Participant[];
  readonly subject: string;
  readonly status: ConversationStatus;
  readonly lastMessageAt: ISOTimestamp | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly closedAt: ISOTimestamp | null;
  readonly closedBy: UserId | null;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly tenantId: TenantId;
  readonly senderId: UserId;
  readonly content: string;
  readonly attachments: readonly MessageAttachment[];
  readonly status: MessageStatus;
  readonly createdAt: ISOTimestamp;
}

export interface ConversationFilters {
  readonly type?: ConversationType | ConversationType[];
  readonly status?: ConversationStatus;
  readonly participantId?: UserId;
}

export interface CreateConversationInput {
  readonly tenantId: TenantId;
  readonly type: ConversationType;
  readonly participants: readonly Omit<Participant, 'joinedAt' | 'lastReadAt'>[];
  readonly subject: string;
  readonly createdBy: UserId;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// Events
// ============================================================================

interface MessagingEventBase extends DomainEvent {
  readonly payload: Record<string, unknown>;
}

export interface MessageSentEvent extends MessagingEventBase {
  readonly eventType: 'MessageSent';
  readonly payload: {
    readonly messageId: string;
    readonly conversationId: string;
    readonly senderId: UserId;
    readonly content: string;
    readonly recipientIds: readonly UserId[];
  };
}

export interface MessageReadEvent extends MessagingEventBase {
  readonly eventType: 'MessageRead';
  readonly payload: {
    readonly messageId: string;
    readonly conversationId: string;
    readonly readerId: UserId;
    readonly readAt: ISOTimestamp;
  };
}

export interface ConversationCreatedEvent extends MessagingEventBase {
  readonly eventType: 'ConversationCreated';
  readonly payload: {
    readonly conversationId: string;
    readonly type: ConversationType;
    readonly subject: string;
    readonly participantIds: readonly UserId[];
    readonly createdBy: UserId;
  };
}

export interface ConversationClosedEvent extends MessagingEventBase {
  readonly eventType: 'ConversationClosed';
  readonly payload: {
    readonly conversationId: string;
    readonly closedBy: UserId;
    readonly closedAt: ISOTimestamp;
  };
}

export type MessagingEvent =
  | MessageSentEvent
  | MessageReadEvent
  | ConversationCreatedEvent
  | ConversationClosedEvent;

// ============================================================================
// WebSocket Integration Point
// ============================================================================

/** Integration point for real-time WebSocket delivery. Implement this to push events to connected clients. */
export interface WebSocketMessagingAdapter {
  /** Broadcast a message to participants in a conversation */
  broadcastToConversation(
    conversationId: string,
    tenantId: TenantId,
    event: string,
    payload: unknown
  ): Promise<void>;

  /** Send event to a specific user */
  sendToUser(userId: UserId, tenantId: TenantId, event: string, payload: unknown): Promise<void>;

  /** Notify users of new message (for real-time delivery) */
  notifyNewMessage(
    conversationId: string,
    tenantId: TenantId,
    message: Message,
    recipientIds: readonly UserId[]
  ): Promise<void>;

  /** Notify users of read receipts */
  notifyMessageRead(
    conversationId: string,
    tenantId: TenantId,
    messageId: string,
    readerId: UserId,
    readAt: ISOTimestamp
  ): Promise<void>;
}

/** No-op adapter when WebSocket is not configured */
export const noOpWebSocketAdapter: WebSocketMessagingAdapter = {
  broadcastToConversation: async () => {},
  sendToUser: async () => {},
  notifyNewMessage: async () => {},
  notifyMessageRead: async () => {},
};

// ============================================================================
// Repository Interface
// ============================================================================

export interface MessagingRepository {
  findConversationById(id: string, tenantId: TenantId): Promise<Conversation | null>;
  findLastMessage(conversationId: string, tenantId: TenantId): Promise<Message | null>;
  findConversations(
    tenantId: TenantId,
    userId: UserId,
    filters?: ConversationFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Conversation>>;
  createConversation(conversation: Conversation): Promise<Conversation>;
  updateConversation(conversation: Conversation): Promise<Conversation>;

  findMessageById(id: string, conversationId: string, tenantId: TenantId): Promise<Message | null>;
  findMessages(
    conversationId: string,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Message>>;
  createMessage(message: Message): Promise<Message>;
  updateMessage(message: Message): Promise<Message>;

  getUnreadCount(tenantId: TenantId, userId: UserId): Promise<number>;
}

// ============================================================================
// Error Types
// ============================================================================

export const MessagingServiceError = {
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  CONVERSATION_CLOSED: 'CONVERSATION_CLOSED',
  USER_NOT_PARTICIPANT: 'USER_NOT_PARTICIPANT',
  PARTICIPANT_ALREADY_ADDED: 'PARTICIPANT_ALREADY_ADDED',
} as const;

export type MessagingServiceErrorCode =
  (typeof MessagingServiceError)[keyof typeof MessagingServiceError];

export interface MessagingServiceErrorResult {
  code: MessagingServiceErrorCode;
  message: string;
}

// ============================================================================
// Messaging Service
// ============================================================================

export class MessagingService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly eventBus: EventBus,
    private readonly wsAdapter: WebSocketMessagingAdapter = noOpWebSocketAdapter
  ) {}

  async createConversation(
    tenantId: TenantId,
    type: ConversationType,
    participants: readonly Omit<Participant, 'joinedAt' | 'lastReadAt'>[],
    subject: string,
    createdBy: UserId,
    metadata?: Record<string, unknown>
  ): Promise<Result<Conversation, MessagingServiceErrorResult>> {
    const now = new Date().toISOString();
    const id = `conv_${Date.now()}_${randomHex(4)}`;

    const participantRecords: Participant[] = participants.map((p) => ({
      userId: p.userId,
      role: p.role,
      joinedAt: now,
      lastReadAt: null,
    }));

    const createdByParticipant = participantRecords.find((p) => p.userId === createdBy);
    if (!createdByParticipant) {
      participantRecords.push({
        userId: createdBy,
        role: 'owner',
        joinedAt: now,
        lastReadAt: null,
      });
    }

    const conversation: Conversation = {
      id,
      tenantId,
      type,
      participants: participantRecords,
      subject,
      status: 'open',
      lastMessageAt: null,
      metadata: metadata ?? {},
      createdAt: now,
      closedAt: null,
      closedBy: null,
    };

    const saved = await this.repo.createConversation(conversation);

    const event: ConversationCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'ConversationCreated',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        conversationId: saved.id,
        type: saved.type,
        subject: saved.subject,
        participantIds: saved.participants.map((p) => p.userId),
        createdBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Conversation'));

    await this.wsAdapter.broadcastToConversation(
      saved.id,
      tenantId,
      'ConversationCreated',
      event.payload
    );

    return ok(saved);
  }

  async sendMessage(
    conversationId: string,
    tenantId: TenantId,
    senderId: UserId,
    content: string,
    attachments?: readonly MessageAttachment[]
  ): Promise<Result<Message, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    if (conversation.status === 'closed') {
      return err({
        code: MessagingServiceError.CONVERSATION_CLOSED,
        message: 'Cannot send message to closed conversation',
      });
    }
    const isParticipant = conversation.participants.some((p) => p.userId === senderId);
    if (!isParticipant) {
      return err({
        code: MessagingServiceError.USER_NOT_PARTICIPANT,
        message: 'Only participants can send messages',
      });
    }

    const now = new Date().toISOString();
    const id = `msg_${Date.now()}_${randomHex(4)}`;

    const message: Message = {
      id,
      conversationId,
      tenantId,
      senderId,
      content,
      attachments: attachments ?? [],
      status: 'sent',
      createdAt: now,
    };

    const saved = await this.repo.createMessage(message);

    const updatedConversation: Conversation = {
      ...conversation,
      lastMessageAt: now,
    };
    await this.repo.updateConversation(updatedConversation);

    const recipientIds = conversation.participants
      .filter((p) => p.userId !== senderId)
      .map((p) => p.userId);

    const event: MessageSentEvent = {
      eventId: generateEventId(),
      eventType: 'MessageSent',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        messageId: saved.id,
        conversationId,
        senderId,
        content: saved.content,
        recipientIds,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Message'));

    await this.wsAdapter.notifyNewMessage(
      conversationId,
      tenantId,
      saved,
      recipientIds
    );

    return ok(saved);
  }

  async getConversation(
    conversationId: string,
    tenantId: TenantId
  ): Promise<Result<Conversation, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    return ok(conversation);
  }

  async getConversations(
    tenantId: TenantId,
    userId: UserId,
    filters?: ConversationFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Conversation>> {
    return this.repo.findConversations(tenantId, userId, filters, pagination);
  }

  async getMessages(
    conversationId: string,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<Result<PaginatedResult<Message>, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    const result = await this.repo.findMessages(conversationId, tenantId, pagination);
    return ok(result);
  }

  async markAsRead(
    conversationId: string,
    tenantId: TenantId,
    userId: UserId
  ): Promise<Result<void, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    const participant = conversation.participants.find((p) => p.userId === userId);
    if (!participant) {
      return err({
        code: MessagingServiceError.USER_NOT_PARTICIPANT,
        message: 'User is not a participant',
      });
    }

    const now = new Date().toISOString();
    const updatedParticipants: Participant[] = conversation.participants.map((p) =>
      p.userId === userId ? { ...p, lastReadAt: now } : p
    );

    const updated: Conversation = {
      ...conversation,
      participants: updatedParticipants,
    };
    await this.repo.updateConversation(updated);

    const lastMessage = await this.repo.findLastMessage(conversationId, tenantId);
    const messageId = lastMessage?.id ?? '';

    const event: MessageReadEvent = {
      eventId: generateEventId(),
      eventType: 'MessageRead',
      timestamp: now,
      tenantId,
      correlationId: conversationId,
      causationId: null,
      metadata: {},
      payload: {
        messageId,
        conversationId,
        readerId: userId,
        readAt: now,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, conversationId, 'Conversation'));

    await this.wsAdapter.notifyMessageRead(
      conversationId,
      tenantId,
      messageId,
      userId,
      now
    );

    return ok(undefined);
  }

  async addParticipant(
    conversationId: string,
    tenantId: TenantId,
    userId: UserId
  ): Promise<Result<Conversation, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    if (conversation.status === 'closed') {
      return err({
        code: MessagingServiceError.CONVERSATION_CLOSED,
        message: 'Cannot add participant to closed conversation',
      });
    }
    const alreadyParticipant = conversation.participants.some((p) => p.userId === userId);
    if (alreadyParticipant) {
      return err({
        code: MessagingServiceError.PARTICIPANT_ALREADY_ADDED,
        message: 'User is already a participant',
      });
    }

    const now = new Date().toISOString();
    const newParticipant: Participant = {
      userId,
      role: 'member',
      joinedAt: now,
      lastReadAt: null,
    };

    const updated: Conversation = {
      ...conversation,
      participants: [...conversation.participants, newParticipant],
    };
    const saved = await this.repo.updateConversation(updated);
    return ok(saved);
  }

  async removeParticipant(
    conversationId: string,
    tenantId: TenantId,
    userId: UserId
  ): Promise<Result<Conversation, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    if (conversation.status === 'closed') {
      return err({
        code: MessagingServiceError.CONVERSATION_CLOSED,
        message: 'Cannot remove participant from closed conversation',
      });
    }

    const updatedParticipants = conversation.participants.filter((p) => p.userId !== userId);
    if (updatedParticipants.length === conversation.participants.length) {
      return err({
        code: MessagingServiceError.USER_NOT_PARTICIPANT,
        message: 'User is not a participant',
      });
    }

    const updated: Conversation = {
      ...conversation,
      participants: updatedParticipants,
    };
    const saved = await this.repo.updateConversation(updated);
    return ok(saved);
  }

  async closeConversation(
    conversationId: string,
    tenantId: TenantId,
    closedBy: UserId
  ): Promise<Result<Conversation, MessagingServiceErrorResult>> {
    const conversation = await this.repo.findConversationById(conversationId, tenantId);
    if (!conversation) {
      return err({
        code: MessagingServiceError.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found',
      });
    }
    if (conversation.status === 'closed') {
      return ok(conversation);
    }

    const now = new Date().toISOString();
    const updated: Conversation = {
      ...conversation,
      status: 'closed',
      closedAt: now,
      closedBy,
    };
    const saved = await this.repo.updateConversation(updated);

    const event: ConversationClosedEvent = {
      eventId: generateEventId(),
      eventType: 'ConversationClosed',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        conversationId: saved.id,
        closedBy,
        closedAt: now,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Conversation'));

    await this.wsAdapter.broadcastToConversation(
      saved.id,
      tenantId,
      'ConversationClosed',
      event.payload
    );

    return ok(saved);
  }

  async getUnreadCount(
    tenantId: TenantId,
    userId: UserId
  ): Promise<Result<number, MessagingServiceErrorResult>> {
    const count = await this.repo.getUnreadCount(tenantId, userId);
    return ok(count);
  }
}

// ============================================================================
// In-Memory Repository (for development/testing)
// ============================================================================

const conversationMap = new Map<string, Conversation>();
const messageMap = new Map<string, Message[]>();

function conversationKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:${id}`;
}

function messagesKey(conversationId: string, tenantId: TenantId): string {
  return `${tenantId}:${conversationId}`;
}

export class MemoryMessagingRepository implements MessagingRepository {
  async findConversationById(id: string, tenantId: TenantId): Promise<Conversation | null> {
    return conversationMap.get(conversationKey(id, tenantId)) ?? null;
  }

  async findConversations(
    tenantId: TenantId,
    userId: UserId,
    filters?: ConversationFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Conversation>> {
    let items = [...conversationMap.values()].filter(
      (c) =>
        c.tenantId === tenantId &&
        c.participants.some((p) => p.userId === userId)
    );

    if (filters?.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      items = items.filter((c) => types.includes(c.type));
    }
    if (filters?.status) {
      items = items.filter((c) => c.status === filters.status);
    }
    if (filters?.participantId) {
      items = items.filter((c) =>
        c.participants.some((p) => p.userId === filters!.participantId)
      );
    }

    items.sort(
      (a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
    );

    const limit = pagination?.limit ?? 50;
    const offset = pagination?.offset ?? 0;
    const total = items.length;
    const slice = items.slice(offset, offset + limit);

    return {
      items: slice,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async createConversation(conversation: Conversation): Promise<Conversation> {
    conversationMap.set(conversationKey(conversation.id, conversation.tenantId), conversation);
    return conversation;
  }

  async updateConversation(conversation: Conversation): Promise<Conversation> {
    conversationMap.set(conversationKey(conversation.id, conversation.tenantId), conversation);
    return conversation;
  }

  async findLastMessage(
    conversationId: string,
    tenantId: TenantId
  ): Promise<Message | null> {
    const messages = messageMap.get(messagesKey(conversationId, tenantId)) ?? [];
    const sorted = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted[0] ?? null;
  }

  async findMessageById(
    id: string,
    conversationId: string,
    tenantId: TenantId
  ): Promise<Message | null> {
    const messages = messageMap.get(messagesKey(conversationId, tenantId)) ?? [];
    return messages.find((m) => m.id === id) ?? null;
  }

  async findMessages(
    conversationId: string,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Message>> {
    const messages =
      [...(messageMap.get(messagesKey(conversationId, tenantId)) ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ) ?? [];

    const limit = pagination?.limit ?? 50;
    const offset = pagination?.offset ?? 0;
    const total = messages.length;
    const slice = messages.slice(offset, offset + limit);

    return {
      items: slice,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async createMessage(message: Message): Promise<Message> {
    const key = messagesKey(message.conversationId, message.tenantId);
    const existing = messageMap.get(key) ?? [];
    existing.push(message);
    messageMap.set(key, existing);
    return message;
  }

  async updateMessage(message: Message): Promise<Message> {
    const key = messagesKey(message.conversationId, message.tenantId);
    const existing = messageMap.get(key) ?? [];
    const idx = existing.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      existing[idx] = message;
    }
    return message;
  }

  async getUnreadCount(tenantId: TenantId, userId: UserId): Promise<number> {
    let count = 0;
    for (const conv of conversationMap.values()) {
      if (conv.tenantId !== tenantId) continue;
      const participant = conv.participants.find((p) => p.userId === userId);
      if (!participant) continue;
      if (!conv.lastMessageAt) continue;
      if (participant.lastReadAt && participant.lastReadAt >= conv.lastMessageAt) continue;
      count++;
    }
    return count;
  }

  clear(): void {
    conversationMap.clear();
    messageMap.clear();
  }
}
