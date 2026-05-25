// @ts-nocheck — domain-models has PaymentMethod/WorkOrder exported as namespaces not types + missing Priority/Status type exports. Rewrite pending domain-models namespace→type refactor. Tracked: BORJIE-42.
/**
 * SLA Management Service
 */

import { getApiClient, ApiResponse } from '../client';
import type { WorkOrderPriority } from '@borjie/domain-models';

export interface SLAConfig {
  priority: WorkOrderPriority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  escalationAfterMinutes: number;
}

export interface SLAMetrics {
  period: {
    start: string;
    end: string;
  };
  overall: {
    responseComplianceRate: number;
    resolutionComplianceRate: number;
    averageResponseTimeMinutes: number;
    averageResolutionTimeMinutes: number;
    totalWorkOrders: number;
    completedWorkOrders: number;
  };
  byPriority: Record<
    WorkOrderPriority,
    {
      count: number;
      responseComplianceRate: number;
      resolutionComplianceRate: number;
      averageResponseTimeMinutes: number;
      averageResolutionTimeMinutes: number;
    }
  >;
  breaches: {
    responseBreaches: number;
    resolutionBreaches: number;
    escalations: number;
  };
  trends: Array<{
    date: string;
    responseComplianceRate: number;
    resolutionComplianceRate: number;
  }>;
}

export interface SLABreachReport {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  unit: string;
  priority: WorkOrderPriority;
  breachType: 'response' | 'resolution';
  breachTime: number; // minutes over SLA
  assignedTo: string | null;
  createdAt: string;
}

export interface SLAHealthCheck {
  atRisk: Array<{
    workOrderId: string;
    workOrderNumber: string;
    title: string;
    priority: WorkOrderPriority;
    type: 'response' | 'resolution';
    remainingMinutes: number;
  }>;
  breached: Array<{
    workOrderId: string;
    workOrderNumber: string;
    title: string;
    priority: WorkOrderPriority;
    type: 'response' | 'resolution';
    breachMinutes: number;
  }>;
}

export const slaService = {
  /**
   * Get SLA configuration for tenant
   */
  async getConfig(): Promise<ApiResponse<SLAConfig[]>> {
    return getApiClient().get<SLAConfig[]>('/sla/config');
  },

  /**
   * Update SLA configuration
   */
  async updateConfig(configs: SLAConfig[]): Promise<ApiResponse<SLAConfig[]>> {
    return getApiClient().put<SLAConfig[]>('/sla/config', { configs });
  },

  /**
   * Get SLA metrics for a period
   */
  async getMetrics(
    period: 'day' | 'week' | 'month' | 'quarter' = 'week',
    propertyId?: string
  ): Promise<ApiResponse<SLAMetrics>> {
    const params: Record<string, string> = { period };
    if (propertyId) {
      params.propertyId = propertyId;
    }
    return getApiClient().get<SLAMetrics>('/sla/metrics', params);
  },

  /**
   * Get SLA breach report
   */
  async getBreachReport(
    startDate: string,
    endDate: string,
    propertyId?: string
  ): Promise<ApiResponse<SLABreachReport[]>> {
    const params: Record<string, string> = {
      startDate,
      endDate,
    };
    if (propertyId) {
      params.propertyId = propertyId;
    }
    return getApiClient().get<SLABreachReport[]>('/sla/breaches', params);
  },

  /**
   * Get real-time SLA health check
   */
  async getHealthCheck(propertyId?: string): Promise<ApiResponse<SLAHealthCheck>> {
    const params: Record<string, string> = {};
    if (propertyId) {
      params.propertyId = propertyId;
    }
    return getApiClient().get<SLAHealthCheck>('/sla/health', params);
  },

  /**
   * Calculate SLA compliance for a work order
   */
  calculateSLAStatus(
    workOrder: {
      priority: WorkOrderPriority;
      createdAt: string;
      sla: {
        respondedAt: string | null;
        resolvedAt: string | null;
        responseDueAt: string;
        resolutionDueAt: string;
        pausedAt: string | null;
        pausedDurationMinutes: number;
      };
    },
    now: Date = new Date()
  ): {
    responseStatus: 'met' | 'at_risk' | 'breached' | 'pending';
    resolutionStatus: 'met' | 'at_risk' | 'breached' | 'pending';
    responseRemainingMinutes: number | null;
    resolutionRemainingMinutes: number | null;
  } {
    const { sla } = workOrder;

    // Response SLA
    let responseStatus: 'met' | 'at_risk' | 'breached' | 'pending';
    let responseRemainingMinutes: number | null = null;

    if (sla.respondedAt) {
      const respondedAt = new Date(sla.respondedAt);
      const responseDue = new Date(sla.responseDueAt);
      responseStatus = respondedAt <= responseDue ? 'met' : 'breached';
    } else if (sla.pausedAt) {
      responseStatus = 'pending';
    } else {
      const responseDue = new Date(sla.responseDueAt);
      responseRemainingMinutes = Math.round((responseDue.getTime() - now.getTime()) / (1000 * 60));
      
      if (responseRemainingMinutes < 0) {
        responseStatus = 'breached';
      } else if (responseRemainingMinutes < 30) {
        responseStatus = 'at_risk';
      } else {
        responseStatus = 'pending';
      }
    }

    // Resolution SLA
    let resolutionStatus: 'met' | 'at_risk' | 'breached' | 'pending';
    let resolutionRemainingMinutes: number | null = null;

    if (sla.resolvedAt) {
      const resolvedAt = new Date(sla.resolvedAt);
      const resolutionDue = new Date(sla.resolutionDueAt);
      resolutionStatus = resolvedAt <= resolutionDue ? 'met' : 'breached';
    } else if (sla.pausedAt) {
      resolutionStatus = 'pending';
    } else {
      const resolutionDue = new Date(sla.resolutionDueAt);
      resolutionRemainingMinutes = Math.round((resolutionDue.getTime() - now.getTime()) / (1000 * 60));
      
      if (resolutionRemainingMinutes < 0) {
        resolutionStatus = 'breached';
      } else if (resolutionRemainingMinutes < 120) {
        resolutionStatus = 'at_risk';
      } else {
        resolutionStatus = 'pending';
      }
    }

    return {
      responseStatus,
      resolutionStatus,
      responseRemainingMinutes,
      resolutionRemainingMinutes,
    };
  },

  /**
   * Format time remaining for display
   */
  formatTimeRemaining(minutes: number | null): string {
    if (minutes === null) return '-';
    if (minutes < 0) return `${Math.abs(minutes)}m overdue`;
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  },

  /**
   * Get SLA color class based on status
   */
  getSLAColorClass(status: 'met' | 'at_risk' | 'breached' | 'pending'): string {
    switch (status) {
      case 'met':
        return 'text-success-600';
      case 'at_risk':
        return 'text-warning-600';
      case 'breached':
        return 'text-danger-600';
      default:
        return 'text-gray-600';
    }
  },
};
