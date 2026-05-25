/**
 * Documents API Service
 * Document management
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type DocumentType =
  | 'LEASE'
  | 'ID_DOCUMENT'
  | 'INVOICE'
  | 'RECEIPT'
  | 'CONTRACT'
  | 'OTHER';

export type DocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Document {
  id: string;
  tenantId: string;
  type: DocumentType;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  verificationStatus: DocumentVerificationStatus;
  verifiedAt?: string;
  verifiedBy?: string;
  tags: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ListDocumentsParams {
  page?: number;
  pageSize?: number;
  type?: DocumentType;
  status?: DocumentVerificationStatus;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface CreateDocumentRequest {
  type: DocumentType;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  tags?: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface UpdateDocumentRequest {
  name?: string;
  tags?: string[];
  verificationStatus?: DocumentVerificationStatus;
}

export const documentsService = {
  /**
   * List documents with filters and pagination
   */
  async list(
    params?: ListDocumentsParams
  ): Promise<ApiResponse<Document[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      type: params?.type,
      status: params?.status,
      relatedEntityType: params?.relatedEntityType,
      relatedEntityId: params?.relatedEntityId,
    });
    return getApiClient().get<Document[]>('/documents', searchParams) as Promise<
      ApiResponse<Document[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get document by ID
   */
  async get(id: string): Promise<ApiResponse<Document>> {
    return getApiClient().get<Document>(`/documents/${id}`);
  },

  /**
   * Create document
   */
  async create(request: CreateDocumentRequest): Promise<ApiResponse<Document>> {
    return getApiClient().post<Document>('/documents', request);
  },

  /**
   * Update document
   */
  async update(id: string, request: UpdateDocumentRequest): Promise<ApiResponse<Document>> {
    return getApiClient().put<Document>(`/documents/${id}`, request);
  },

  /**
   * Delete document
   */
  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return getApiClient().delete<{ message: string }>(`/documents/${id}`);
  },
};
