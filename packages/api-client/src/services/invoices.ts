/**
 * Invoices API Service
 * Invoice management
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PENDING'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export interface InvoiceLineItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  customerId: string;
  leaseId?: string;
  status: InvoiceStatus;
  type: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  customer?: { id: string; name: string };
  unit?: { id: string; unitNumber: string };
  createdAt: string;
  updatedAt: string;
}

export interface ListInvoicesParams {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  customerId?: string;
  leaseId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateInvoiceRequest {
  customerId: string;
  leaseId?: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  subtotal: number;
  tax?: number;
  currency: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export interface UpdateInvoiceRequest {
  customerId?: string;
  leaseId?: string;
  type?: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  subtotal?: number;
  tax?: number;
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export interface SendInvoiceRequest {
  channel?: 'email' | 'sms' | 'whatsapp';
  customMessage?: string;
}

export interface InvoicePdfResponse {
  pdfUrl?: string;
  invoiceNumber: string;
  expiresAt: string;
  contentType: string;
}

export const invoicesService = {
  /**
   * List invoices with filters and pagination
   */
  async list(
    params?: ListInvoicesParams
  ): Promise<ApiResponse<Invoice[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      status: params?.status,
      customerId: params?.customerId,
      leaseId: params?.leaseId,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
    });
    return getApiClient().get<Invoice[]>('/invoices', searchParams) as Promise<
      ApiResponse<Invoice[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get overdue invoices
   */
  async getOverdue(
    params?: { page?: number; pageSize?: number }
  ): Promise<ApiResponse<Invoice[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
    });
    return getApiClient().get<Invoice[]>('/invoices/overdue', searchParams) as Promise<
      ApiResponse<Invoice[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get invoice by ID
   */
  async get(id: string): Promise<ApiResponse<Invoice>> {
    return getApiClient().get<Invoice>(`/invoices/${id}`);
  },

  /**
   * Create invoice
   */
  async create(request: CreateInvoiceRequest): Promise<ApiResponse<Invoice>> {
    return getApiClient().post<Invoice>('/invoices', request);
  },

  /**
   * Update invoice (draft only)
   */
  async update(id: string, request: UpdateInvoiceRequest): Promise<ApiResponse<Invoice>> {
    return getApiClient().put<Invoice>(`/invoices/${id}`, request);
  },

  /**
   * Cancel invoice
   */
  async cancel(id: string): Promise<ApiResponse<Invoice>> {
    return getApiClient().delete<Invoice>(`/invoices/${id}`);
  },

  /**
   * Send invoice to customer
   */
  async send(id: string, request?: SendInvoiceRequest): Promise<ApiResponse<Invoice>> {
    return getApiClient().post<Invoice>(`/invoices/${id}/send`, request ?? {});
  },

  /**
   * Get invoice PDF metadata (or download with ?download=1)
   */
  async getPdf(id: string, download?: boolean): Promise<ApiResponse<InvoicePdfResponse>> {
    const options = download ? { params: { download: '1' } } : undefined;
    return getApiClient().get<InvoicePdfResponse>(`/invoices/${id}/pdf`, options);
  },
};
