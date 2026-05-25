/**
 * Messaging API Service
 * Chat and messaging
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ';

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  senderId: string;
  senderType: 'customer' | 'manager' | 'system';
  content: string;
  status: MessageStatus;
  attachments?: Array<{ type: string; url: string; filename: string }>;
  readAt?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  participants: Array<{
    id: string;
    type: 'customer' | 'manager';
    name?: string;
  }>;
  subject?: string;
  lastMessage?: Message;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListConversationsParams {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

export interface ListMessagesParams {
  page?: number;
  pageSize?: number;
  before?: string;
  after?: string;
}

export interface SendMessageRequest {
  content: string;
  attachments?: Array<{ type: string; url: string; filename: string }>;
}

export interface CreateConversationRequest {
  participantId: string;
  subject?: string;
  initialMessage?: string;
}

export const messagingService = {
  /**
   * List conversations
   */
  async listConversations(
    params?: ListConversationsParams
  ): Promise<ApiResponse<Conversation[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      unreadOnly: params?.unreadOnly,
    });
    return getApiClient().get<Conversation[]>('/messaging/conversations', searchParams) as Promise<
      ApiResponse<Conversation[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get conversation by ID
   */
  async getConversation(id: string): Promise<ApiResponse<Conversation>> {
    return getApiClient().get<Conversation>(`/messaging/conversations/${id}`);
  },

  /**
   * Create conversation
   */
  async createConversation(
    request: CreateConversationRequest
  ): Promise<ApiResponse<Conversation>> {
    return getApiClient().post<Conversation>('/messaging/conversations', request);
  },

  /**
   * List messages in conversation
   */
  async listMessages(
    conversationId: string,
    params?: ListMessagesParams
  ): Promise<ApiResponse<Message[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      before: params?.before,
      after: params?.after,
    });
    return getApiClient().get<Message[]>(
      `/messaging/conversations/${conversationId}/messages`,
      searchParams
    ) as Promise<ApiResponse<Message[]> & { pagination?: PaginationInfo }>;
  },

  /**
   * Send message
   */
  async sendMessage(
    conversationId: string,
    request: SendMessageRequest
  ): Promise<ApiResponse<Message>> {
    return getApiClient().post<Message>(
      `/messaging/conversations/${conversationId}/messages`,
      request
    );
  },

  /**
   * Mark conversation as read
   */
  async markAsRead(conversationId: string): Promise<ApiResponse<Conversation>> {
    return getApiClient().post<Conversation>(
      `/messaging/conversations/${conversationId}/read`,
      {}
    );
  },

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<ApiResponse<{ count: number }>> {
    return getApiClient().get<{ count: number }>('/messaging/unread-count');
  },
};
