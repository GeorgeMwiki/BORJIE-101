/**
 * In-memory repository implementations for Feedback Engine.
 * Use for testing, development, or as a reference for persistence implementations.
 */

import type {
  FeedbackRequest,
  FeedbackRequestId,
  FeedbackResponse,
  FeedbackResponseId,
  Complaint,
  ComplaintId,
  ServiceRecoveryCase,
  ServiceRecoveryCaseId,
  FeedbackRequestRepository,
  FeedbackResponseRepository,
  ComplaintRepository,
  ServiceRecoveryCaseRepository,
} from './index.js';
import type { TenantId, CustomerId, ISOTimestamp } from '@borjie/domain-models';

// ============================================================================
// Feedback Request Repository
// ============================================================================

export class InMemoryFeedbackRequestRepository implements FeedbackRequestRepository {
  private requests = new Map<string, FeedbackRequest>();

  private key(id: FeedbackRequestId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  async findById(id: FeedbackRequestId, tenantId: TenantId): Promise<FeedbackRequest | null> {
    return this.requests.get(this.key(id, tenantId)) ?? null;
  }

  async create(request: FeedbackRequest): Promise<FeedbackRequest> {
    this.requests.set(this.key(request.id, request.tenantId), request);
    return request;
  }

  async update(request: FeedbackRequest): Promise<FeedbackRequest> {
    this.requests.set(this.key(request.id, request.tenantId), request);
    return request;
  }

  async findPendingByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<FeedbackRequest[]> {
    return [...this.requests.values()].filter(
      (r) =>
        r.tenantId === tenantId &&
        r.customerId === customerId &&
        ['pending', 'sent'].includes(r.status)
    );
  }
}

// ============================================================================
// Feedback Response Repository
// ============================================================================

export class InMemoryFeedbackResponseRepository implements FeedbackResponseRepository {
  private responses = new Map<string, FeedbackResponse>();

  private key(id: FeedbackResponseId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  async create(response: FeedbackResponse): Promise<FeedbackResponse> {
    this.responses.set(this.key(response.id, response.tenantId), response);
    return response;
  }

  async findById(id: FeedbackResponseId, tenantId: TenantId): Promise<FeedbackResponse | null> {
    return this.responses.get(this.key(id, tenantId)) ?? null;
  }

  async findByRequest(
    requestId: FeedbackRequestId,
    tenantId: TenantId
  ): Promise<FeedbackResponse | null> {
    return [...this.responses.values()].find(
      (r) => r.tenantId === tenantId && r.requestId === requestId
    ) ?? null;
  }

  async findManyByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    period?: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<FeedbackResponse[]> {
    let items = [...this.responses.values()].filter(
      (r) => r.tenantId === tenantId && r.customerId === customerId
    );
    if (period) {
      const start = new Date(period.start).getTime();
      const end = new Date(period.end).getTime();
      items = items.filter((r) => {
        const t = new Date(r.submittedAt).getTime();
        return t >= start && t <= end;
      });
    }
    return items;
  }

  async findManyByTenant(
    tenantId: TenantId,
    period?: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<FeedbackResponse[]> {
    let items = [...this.responses.values()].filter((r) => r.tenantId === tenantId);
    if (period) {
      const start = new Date(period.start).getTime();
      const end = new Date(period.end).getTime();
      items = items.filter((r) => {
        const t = new Date(r.submittedAt).getTime();
        return t >= start && t <= end;
      });
    }
    return items;
  }
}

// ============================================================================
// Complaint Repository
// ============================================================================

export class InMemoryComplaintRepository implements ComplaintRepository {
  private complaints = new Map<string, Complaint>();

  private key(id: ComplaintId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  async create(complaint: Complaint): Promise<Complaint> {
    this.complaints.set(this.key(complaint.id, complaint.tenantId), complaint);
    return complaint;
  }

  async update(complaint: Complaint): Promise<Complaint> {
    this.complaints.set(this.key(complaint.id, complaint.tenantId), complaint);
    return complaint;
  }

  async findById(id: ComplaintId, tenantId: TenantId): Promise<Complaint | null> {
    return this.complaints.get(this.key(id, tenantId)) ?? null;
  }

  async findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<Complaint[]> {
    return [...this.complaints.values()].filter(
      (c) => c.tenantId === tenantId && c.customerId === customerId
    );
  }

  async countByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<number> {
    return (await this.findByCustomer(customerId, tenantId)).length;
  }
}

// ============================================================================
// Service Recovery Case Repository
// ============================================================================

export class InMemoryServiceRecoveryCaseRepository implements ServiceRecoveryCaseRepository {
  private cases = new Map<string, ServiceRecoveryCase>();

  private key(id: ServiceRecoveryCaseId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  async create(case_: ServiceRecoveryCase): Promise<ServiceRecoveryCase> {
    this.cases.set(this.key(case_.id, case_.tenantId), case_);
    return case_;
  }

  async update(case_: ServiceRecoveryCase): Promise<ServiceRecoveryCase> {
    this.cases.set(this.key(case_.id, case_.tenantId), case_);
    return case_;
  }

  async findById(id: ServiceRecoveryCaseId, tenantId: TenantId): Promise<ServiceRecoveryCase | null> {
    return this.cases.get(this.key(id, tenantId)) ?? null;
  }

  async findByComplaint(
    complaintId: ComplaintId,
    tenantId: TenantId
  ): Promise<ServiceRecoveryCase | null> {
    return [...this.cases.values()].find(
      (c) => c.tenantId === tenantId && c.complaintId === complaintId
    ) ?? null;
  }
}
