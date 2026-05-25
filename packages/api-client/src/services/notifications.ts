/**
 * Notifications API Service
 */

import { getApiClient, ApiResponse } from '../client';
import type {
  Notification,
  NotificationId,
  NotificationStatus,
  NotificationCategory,
} from '@borjie/domain-models';

export interface NotificationFilters {
  status?: NotificationStatus[];
  category?: NotificationCategory[];
  read?: boolean;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  whatsapp: boolean;
  categories: {
    [key in NotificationCategory]?: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
  };
}

export const notificationsService = {
  /**
   * List notifications
   */
  async list(
    filters?: NotificationFilters,
    page = 1,
    limit = 20
  ): Promise<ApiResponse<Notification[]>> {
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
    };

    if (filters?.status?.length) {
      params.status = filters.status.join(',');
    }
    if (filters?.category?.length) {
      params.category = filters.category.join(',');
    }
    if (filters?.read !== undefined) {
      params.read = String(filters.read);
    }

    return getApiClient().get<Notification[]>('/notifications', params);
  },

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<ApiResponse<{ count: number }>> {
    return getApiClient().get<{ count: number }>('/notifications/unread-count');
  },

  /**
   * Mark notification as read
   */
  async markAsRead(id: NotificationId): Promise<ApiResponse<Notification>> {
    return getApiClient().post<Notification>(`/notifications/${id}/read`, {});
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<ApiResponse<{ count: number }>> {
    return getApiClient().post<{ count: number }>('/notifications/read-all', {});
  },

  /**
   * Get notification preferences
   */
  async getPreferences(): Promise<ApiResponse<NotificationPreferences>> {
    return getApiClient().get<NotificationPreferences>('/notifications/preferences');
  },

  /**
   * Update notification preferences
   */
  async updatePreferences(
    preferences: Partial<NotificationPreferences>
  ): Promise<ApiResponse<NotificationPreferences>> {
    return getApiClient().put<NotificationPreferences>('/notifications/preferences', preferences);
  },

  /**
   * Register device for push notifications
   */
  async registerDevice(token: string, platform: 'ios' | 'android' | 'web'): Promise<ApiResponse<void>> {
    return getApiClient().post('/notifications/devices', { token, platform });
  },

  /**
   * Unregister device
   */
  async unregisterDevice(token: string): Promise<ApiResponse<void>> {
    return getApiClient().delete(`/notifications/devices/${token}`);
  },
};
