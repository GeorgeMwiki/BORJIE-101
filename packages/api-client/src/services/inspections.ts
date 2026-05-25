/**
 * Inspections API Service
 */

import { getApiClient, ApiResponse } from '../client';
import type {
  Inspection,
  InspectionId,
  InspectionStatus,
  InspectionType,
  InspectionItem,
  ConditionRating,
} from '@borjie/domain-models';

export interface InspectionFilters {
  status?: InspectionStatus[];
  type?: InspectionType[];
  assignedTo?: string;
  propertyId?: string;
  unitId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateInspectionRequest {
  propertyId: string;
  unitId: string;
  type: InspectionType;
  scheduledDate: string;
  scheduledTimeSlot?: string;
  assignedTo: string;
}

export interface InspectionItemInput {
  area: string;
  item: string;
  condition: ConditionRating;
  notes?: string;
  requiresAction: boolean;
  photoUrls?: string[];
}

export interface CompleteInspectionRequest {
  overallCondition: ConditionRating;
  summary: string;
  recommendations?: string;
  followUpRequired?: boolean;
  followUpNotes?: string;
  customerPresent?: boolean;
  customerSignatureUrl?: string;
  inspectorSignatureUrl?: string;
}

export const inspectionsService = {
  /**
   * List inspections with optional filters
   */
  async list(filters?: InspectionFilters, page = 1, limit = 20): Promise<ApiResponse<Inspection[]>> {
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
    };

    if (filters?.status?.length) {
      params.status = filters.status.join(',');
    }
    if (filters?.type?.length) {
      params.type = filters.type.join(',');
    }
    if (filters?.assignedTo) {
      params.assignedTo = filters.assignedTo;
    }
    if (filters?.propertyId) {
      params.propertyId = filters.propertyId;
    }
    if (filters?.unitId) {
      params.unitId = filters.unitId;
    }
    if (filters?.dateFrom) {
      params.dateFrom = filters.dateFrom;
    }
    if (filters?.dateTo) {
      params.dateTo = filters.dateTo;
    }

    return getApiClient().get<Inspection[]>('/inspections', params);
  },

  /**
   * Get a single inspection by ID
   */
  async get(id: InspectionId): Promise<ApiResponse<Inspection>> {
    return getApiClient().get<Inspection>(`/inspections/${id}`);
  },

  /**
   * Create a new inspection
   */
  async create(request: CreateInspectionRequest): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>('/inspections', request);
  },

  /**
   * Start an inspection
   */
  async start(id: InspectionId): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>(`/inspections/${id}/start`, {});
  },

  /**
   * Add an inspection item
   */
  async addItem(id: InspectionId, item: InspectionItemInput): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>(`/inspections/${id}/items`, item);
  },

  /**
   * Update an inspection item
   */
  async updateItem(
    id: InspectionId,
    itemIndex: number,
    item: Partial<InspectionItemInput>
  ): Promise<ApiResponse<Inspection>> {
    return getApiClient().patch<Inspection>(`/inspections/${id}/items/${itemIndex}`, item);
  },

  /**
   * Complete an inspection
   */
  async complete(
    id: InspectionId,
    data: CompleteInspectionRequest
  ): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>(`/inspections/${id}/complete`, data);
  },

  /**
   * Cancel an inspection
   */
  async cancel(id: InspectionId, reason: string): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>(`/inspections/${id}/cancel`, { reason });
  },

  /**
   * Reschedule an inspection
   */
  async reschedule(
    id: InspectionId,
    data: { scheduledDate: string; scheduledTimeSlot?: string }
  ): Promise<ApiResponse<Inspection>> {
    return getApiClient().post<Inspection>(`/inspections/${id}/reschedule`, data);
  },

  /**
   * Get inspections assigned to current user
   */
  async getMyInspections(status?: InspectionStatus[]): Promise<ApiResponse<Inspection[]>> {
    const params: Record<string, string> = {};
    if (status?.length) {
      params.status = status.join(',');
    }
    return getApiClient().get<Inspection[]>('/inspections/my-inspections', params);
  },

  /**
   * Generate inspection report PDF
   */
  async generateReport(id: InspectionId): Promise<ApiResponse<{ reportUrl: string }>> {
    return getApiClient().post<{ reportUrl: string }>(`/inspections/${id}/report`, {});
  },
};
