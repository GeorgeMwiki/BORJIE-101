import { randomHex } from '../common/id-generator.js';
/**
 * Feedback Engine service (Module B)
 *
 * Handles feedback lifecycle, NPS, complaints, sentiment analysis,
 * service recovery, and escalation for the BORJIE platform.
 */

import type { TenantId, UserId, CustomerId, Result, ISOTimestamp } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import { ok, err } from '@borjie/domain-models';

// ============================================================================
// Branded IDs
// ============================================================================

export type FeedbackRequestId = string & { __brand: 'FeedbackRequestId' };
export type FeedbackResponseId = string & { __brand: 'FeedbackResponseId' };
export type ComplaintId = string & { __brand: 'ComplaintId' };
export type ServiceRecoveryCaseId = string & { __brand: 'ServiceRecoveryCaseId' };

export function asFeedbackRequestId(id: string): FeedbackRequestId {
  return id as FeedbackRequestId;
}

export function asComplaintId(id: string): ComplaintId {
  return id as ComplaintId;
}

export function asServiceRecoveryCaseId(id: string): ServiceRecoveryCaseId {
  return id as ServiceRecoveryCaseId;
}

// ============================================================================
// Feedback Types (per spec)
// ============================================================================

/** Prompted feedback types - transactional and periodic */
export type FeedbackType =
  | 'post_maintenance' // After work order completion
  | 'post_move_in' // First week check-in
  | 'periodic_nps' // Quarterly satisfaction pulse
  | 'exit_survey'; // When lease terminates

/** Complaint categories per Module B spec */
export type ComplaintCategory =
  | 'maintenance'
  | 'security'
  | 'noise'
  | 'staff_behavior'
  | 'utilities'
  | 'cleanliness'
  | 'other';

/** Sentiment categories from AI analysis */
export type SentimentLabel =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'frustrated'
  | 'anxious'
  | 'appreciative';

// ============================================================================
// Core Types
// ============================================================================

/** Prompted feedback request (NPS, satisfaction surveys) */
export interface FeedbackRequest {
  readonly id: FeedbackRequestId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly type: FeedbackType;
  readonly context: FeedbackRequestContext;
  readonly channel: 'whatsapp' | 'sms' | 'email' | 'app' | 'in_person';
  readonly status: 'pending' | 'sent' | 'responded' | 'expired';
  readonly sentAt: ISOTimestamp | null;
  readonly expiresAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface FeedbackRequestContext {
  readonly workOrderId?: string;
  readonly leaseId?: string;
  readonly moveInDate?: ISOTimestamp;
  readonly leaseEndDate?: ISOTimestamp;
}

/** Tenant's response to a feedback request */
export interface FeedbackResponse {
  readonly id: FeedbackResponseId;
  readonly requestId: FeedbackRequestId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly rating: number; // 1-5 or 0-10 for NPS
  readonly npsScore?: number; // 0-10 for NPS type
  readonly comment: string | null;
  readonly sentimentAnalysis: SentimentAnalysis | null;
  readonly submittedAt: ISOTimestamp;
  readonly metadata: Record<string, unknown>;
}

/** Escalated issue (complaint) */
export interface Complaint {
  readonly id: ComplaintId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly category: ComplaintCategory;
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly status: 'open' | 'in_progress' | 'resolved' | 'escalated';
  readonly sentimentAnalysis: SentimentAnalysis | null;
  readonly sourceFeedbackId?: FeedbackResponseId;
  readonly sourceRequestId?: FeedbackRequestId;
  readonly evidenceAttachments: readonly string[];
  readonly escalatedToManager: boolean;
  readonly complaintCount: number; // For repeated complaints escalation
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

/** AI-analyzed sentiment (integration point for AI) */
export interface SentimentAnalysis {
  readonly score: number; // -1 to 1 (negative to positive)
  readonly label: SentimentLabel;
  readonly confidence: number; // 0 to 1
  readonly keyPhrases: readonly string[];
  readonly emotionDensity: Record<string, number>;
  readonly analyzedAt: ISOTimestamp;
  readonly provider?: string; // AI provider identifier
}

/** Service recovery case - complaint resolution tracking */
export interface ServiceRecoveryCase {
  readonly id: ServiceRecoveryCaseId;
  readonly complaintId: ComplaintId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly status: 'open' | 'in_progress' | 'resolved' | 'closed';
  readonly resolution: string | null;
  readonly resolvedAt: ISOTimestamp | null;
  readonly resolvedBy: UserId | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Analytics Types
// ============================================================================

export interface SentimentTrend {
  readonly customerId: CustomerId;
  readonly tenantId: TenantId;
  readonly period: { start: ISOTimestamp; end: ISOTimestamp };
  readonly dataPoints: readonly SentimentDataPoint[];
  readonly averageScore: number;
  readonly trend: 'improving' | 'stable' | 'declining';
}

export interface SentimentDataPoint {
  readonly timestamp: ISOTimestamp;
  readonly score: number;
  readonly label: SentimentLabel;
  readonly source: 'feedback' | 'complaint';
}

export interface NPSScore {
  readonly tenantId: TenantId;
  readonly period: { start: ISOTimestamp; end: ISOTimestamp };
  readonly score: number; // -100 to 100
  readonly responseCount: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
}

export interface FeedbackAnalytics {
  readonly tenantId: TenantId;
  readonly period: { start: ISOTimestamp; end: ISOTimestamp };
  readonly averageRating: number;
  readonly totalResponses: number;
  readonly npsScore: NPSScore;
  readonly sentimentTrend: SentimentTrend;
  readonly complaintCount: number;
  readonly serviceRecoveryCount: number;
  readonly topCategories: readonly { category: string; count: number }[];
}

// ============================================================================
// Escalation Rules
// ============================================================================

export const ESCALATION_RULES = {
  /** Low rating threshold (1-5 scale) - triggers service recovery */
  LOW_RATING_THRESHOLD: 3,
  /** Negative sentiment threshold - flags for review */
  NEGATIVE_SENTIMENT_THRESHOLD: 0,
  /** Repeated complaints count - escalates to manager */
  REPEATED_COMPLAINTS_THRESHOLD: 2,
} as const;

// ============================================================================
// Domain Events
// ============================================================================

export interface FeedbackReceivedEvent {
  eventId: string;
  eventType: 'FeedbackReceived';
  timestamp: ISOTimestamp;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    responseId: FeedbackResponseId;
    requestId: FeedbackRequestId;
    customerId: CustomerId;
    rating: number;
    npsScore?: number;
    hasComment: boolean;
    sentimentScore?: number;
    feedbackType: FeedbackType;
  };
}

export interface ComplaintEscalatedEvent {
  eventId: string;
  eventType: 'ComplaintEscalated';
  timestamp: ISOTimestamp;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    complaintId: ComplaintId;
    customerId: CustomerId;
    reason: 'low_rating' | 'negative_sentiment' | 'repeated_complaints';
  };
}

export interface ServiceRecoveryCaseCreatedEvent {
  eventId: string;
  eventType: 'ServiceRecoveryCaseCreated';
  timestamp: ISOTimestamp;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    caseId: ServiceRecoveryCaseId;
    complaintId: ComplaintId;
    customerId: CustomerId;
    triggerReason: string;
  };
}

export interface ServiceRecoveryCaseResolvedEvent {
  eventId: string;
  eventType: 'ServiceRecoveryCaseResolved';
  timestamp: ISOTimestamp;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    caseId: ServiceRecoveryCaseId;
    complaintId: ComplaintId;
    customerId: CustomerId;
    resolution: string;
  };
}

// ============================================================================
// Sentiment Analysis Provider (AI Integration Point)
// ============================================================================

/** Interface for AI sentiment analysis - pluggable provider */
export interface SentimentAnalysisProvider {
  analyze(text: string): Promise<SentimentAnalysis>;
}

/** Default implementation - can be replaced with AI provider */
export class DefaultSentimentAnalysisProvider implements SentimentAnalysisProvider {
  async analyze(text: string): Promise<SentimentAnalysis> {
    // Placeholder - integrates with AI (e.g., OpenAI, Azure, local LLM)
    // In production: call AI API for sentiment analysis
    const now = new Date().toISOString();
    const trimmed = text.trim().toLowerCase();

    // Simple heuristic fallback when AI not configured
    const negativeWords = ['bad', 'terrible', 'awful', 'worst', 'horrible', 'frustrated', 'angry', 'disappointed'];
    const positiveWords = ['good', 'great', 'excellent', 'awesome', 'happy', 'satisfied', 'thank'];

    let score = 0;
    let label: SentimentLabel = 'neutral';

    for (const word of negativeWords) {
      if (trimmed.includes(word)) {
        score -= 0.3;
        label = 'negative';
      }
    }
    for (const word of positiveWords) {
      if (trimmed.includes(word)) {
        score += 0.3;
        label = 'positive';
      }
    }

    score = Math.max(-1, Math.min(1, score));
    if (score > 0.2 && label === 'neutral') label = 'positive';
    if (score < -0.2 && label === 'neutral') label = 'negative';

    return {
      score,
      label,
      confidence: 0.7,
      keyPhrases: [],
      emotionDensity: {},
      analyzedAt: now,
      provider: 'default',
    };
  }
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface FeedbackRequestRepository {
  findById(id: FeedbackRequestId, tenantId: TenantId): Promise<FeedbackRequest | null>;
  create(request: FeedbackRequest): Promise<FeedbackRequest>;
  update(request: FeedbackRequest): Promise<FeedbackRequest>;
  findPendingByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<FeedbackRequest[]>;
}

export interface FeedbackResponseRepository {
  create(response: FeedbackResponse): Promise<FeedbackResponse>;
  findById(id: FeedbackResponseId, tenantId: TenantId): Promise<FeedbackResponse | null>;
  findByRequest(requestId: FeedbackRequestId, tenantId: TenantId): Promise<FeedbackResponse | null>;
  findManyByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    period?: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<FeedbackResponse[]>;
  findManyByTenant(
    tenantId: TenantId,
    period?: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<FeedbackResponse[]>;
}

export interface ComplaintRepository {
  create(complaint: Complaint): Promise<Complaint>;
  update(complaint: Complaint): Promise<Complaint>;
  findById(id: ComplaintId, tenantId: TenantId): Promise<Complaint | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<Complaint[]>;
  countByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<number>;
}

export interface ServiceRecoveryCaseRepository {
  create(case_: ServiceRecoveryCase): Promise<ServiceRecoveryCase>;
  update(case_: ServiceRecoveryCase): Promise<ServiceRecoveryCase>;
  findById(id: ServiceRecoveryCaseId, tenantId: TenantId): Promise<ServiceRecoveryCase | null>;
  findByComplaint(complaintId: ComplaintId, tenantId: TenantId): Promise<ServiceRecoveryCase | null>;
}

// ============================================================================
// Error Types
// ============================================================================

export const FeedbackServiceError = {
  FEEDBACK_REQUEST_NOT_FOUND: 'FEEDBACK_REQUEST_NOT_FOUND',
  FEEDBACK_REQUEST_EXPIRED: 'FEEDBACK_REQUEST_EXPIRED',
  FEEDBACK_ALREADY_SUBMITTED: 'FEEDBACK_ALREADY_SUBMITTED',
  INVALID_RATING: 'INVALID_RATING',
  COMPLAINT_NOT_FOUND: 'COMPLAINT_NOT_FOUND',
  CASE_NOT_FOUND: 'CASE_NOT_FOUND',
  SENTIMENT_ANALYSIS_FAILED: 'SENTIMENT_ANALYSIS_FAILED',
} as const;

export type FeedbackServiceErrorCode = (typeof FeedbackServiceError)[keyof typeof FeedbackServiceError];

export interface FeedbackServiceErrorResult {
  code: FeedbackServiceErrorCode;
  message: string;
}

// ============================================================================
// Feedback Service Implementation
// ============================================================================

export class FeedbackService {
  constructor(
    private readonly feedbackRequestRepo: FeedbackRequestRepository,
    private readonly feedbackResponseRepo: FeedbackResponseRepository,
    private readonly complaintRepo: ComplaintRepository,
    private readonly serviceRecoveryRepo: ServiceRecoveryCaseRepository,
    private readonly eventBus: EventBus,
    private readonly sentimentProvider: SentimentAnalysisProvider = new DefaultSentimentAnalysisProvider()
  ) {}

  /**
   * Send a feedback request to a customer (NPS, satisfaction, etc.)
   */
  async sendFeedbackRequest(
    tenantId: TenantId,
    customerId: CustomerId,
    type: FeedbackType,
    context: FeedbackRequestContext,
    options?: { channel?: FeedbackRequest['channel']; correlationId?: string }
  ): Promise<Result<FeedbackRequest, FeedbackServiceErrorResult>> {
    const id = asFeedbackRequestId(`fr_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();

    const expiresAt = this.getExpiryForType(type);

    const request: FeedbackRequest = {
      id,
      tenantId,
      customerId,
      type,
      context,
      channel: options?.channel ?? 'whatsapp',
      status: 'sent',
      sentAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.feedbackRequestRepo.create(request);
    return ok(saved);
  }

  /**
   * Submit feedback response from tenant
   */
  async submitFeedback(
    requestId: FeedbackRequestId,
    tenantId: TenantId,
    rating: number,
    comment: string | null,
    options?: { correlationId?: string }
  ): Promise<Result<FeedbackResponse, FeedbackServiceErrorResult>> {
    const request = await this.feedbackRequestRepo.findById(requestId, tenantId);
    if (!request) {
      return err({
        code: FeedbackServiceError.FEEDBACK_REQUEST_NOT_FOUND,
        message: 'Feedback request not found',
      });
    }

    if (request.status === 'responded') {
      return err({
        code: FeedbackServiceError.FEEDBACK_ALREADY_SUBMITTED,
        message: 'Feedback already submitted for this request',
      });
    }

    const maxRating = request.type === 'periodic_nps' ? 10 : 5;
    if (rating < 0 || rating > maxRating) {
      return err({
        code: FeedbackServiceError.INVALID_RATING,
        message: `Rating must be between 0 and ${maxRating}`,
      });
    }

    let sentimentAnalysis: SentimentAnalysis | null = null;
    if (comment && comment.trim().length > 0) {
      try {
        sentimentAnalysis = await this.sentimentProvider.analyze(comment);
      } catch {
        // Continue without sentiment if analysis fails
      }
    }

    const responseId = `fresp_${Date.now()}_${randomHex(4)}` as FeedbackResponseId;
    const now = new Date().toISOString();

    const response: FeedbackResponse = {
      id: responseId,
      requestId,
      tenantId: request.tenantId,
      customerId: request.customerId,
      rating,
      ...(request.type === 'periodic_nps' && { npsScore: rating }),
      comment,
      sentimentAnalysis,
      submittedAt: now,
      metadata: {},
    };

    const savedResponse = await this.feedbackResponseRepo.create(response);

    const updatedRequest: FeedbackRequest = {
      ...request,
      status: 'responded',
      updatedAt: now,
    };
    await this.feedbackRequestRepo.update(updatedRequest);

    // Apply escalation rules
    await this.applyEscalationRules(request, savedResponse);

    // Publish event
    const event: FeedbackReceivedEvent = {
      eventId: generateEventId(),
      eventType: 'FeedbackReceived',
      timestamp: now,
      tenantId: request.tenantId,
      correlationId: options?.correlationId ?? requestId,
      causationId: null,
      metadata: {},
      payload: {
        responseId: savedResponse.id,
        requestId,
        customerId: request.customerId,
        rating,
        ...(savedResponse.npsScore !== undefined && { npsScore: savedResponse.npsScore }),
        hasComment: !!comment,
        ...(sentimentAnalysis?.score !== undefined && { sentimentScore: sentimentAnalysis.score }),
        feedbackType: request.type,
      },
    };

    await this.eventBus.publish(
      createEventEnvelope(event, savedResponse.id, 'FeedbackResponse')
    );

    return ok(savedResponse);
  }

  /**
   * Submit a complaint (escalated issue)
   */
  async submitComplaint(
    tenantId: TenantId,
    customerId: CustomerId,
    category: ComplaintCategory,
    description: string,
    options?: {
      sourceFeedbackId?: FeedbackResponseId;
      sourceRequestId?: FeedbackRequestId;
      correlationId?: string;
    }
  ): Promise<Result<Complaint, FeedbackServiceErrorResult>> {
    const id = asComplaintId(`complaint_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();

    let sentimentAnalysis: SentimentAnalysis | null = null;
    try {
      sentimentAnalysis = await this.sentimentProvider.analyze(description);
    } catch {
      // Continue without sentiment
    }

    const complaintCount = await this.complaintRepo.countByCustomer(customerId, tenantId);
    const escalatedToManager = complaintCount >= ESCALATION_RULES.REPEATED_COMPLAINTS_THRESHOLD;

    const complaint: Complaint = {
      id,
      tenantId,
      customerId,
      category,
      description,
      severity: this.inferSeverity(description, sentimentAnalysis),
      status: escalatedToManager ? 'escalated' : 'open',
      sentimentAnalysis,
      ...(options?.sourceFeedbackId !== undefined && { sourceFeedbackId: options.sourceFeedbackId }),
      ...(options?.sourceRequestId !== undefined && { sourceRequestId: options.sourceRequestId }),
      evidenceAttachments: [],
      escalatedToManager,
      complaintCount: complaintCount + 1,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.complaintRepo.create(complaint);

    if (escalatedToManager) {
      await this.publishComplaintEscalatedEvent(saved, 'repeated_complaints', options?.correlationId);
    }

    return ok(saved);
  }

  /**
   * Analyze sentiment of text (AI integration point)
   */
  async analyzeSentiment(text: string): Promise<Result<SentimentAnalysis, FeedbackServiceErrorResult>> {
    try {
      const result = await this.sentimentProvider.analyze(text);
      return ok(result);
    } catch (error) {
      return err({
        code: FeedbackServiceError.SENTIMENT_ANALYSIS_FAILED,
        message: error instanceof Error ? error.message : 'Sentiment analysis failed',
      });
    }
  }

  /**
   * Create service recovery case from complaint
   */
  async createServiceRecoveryCase(
    complaintId: ComplaintId,
    tenantId: TenantId,
    options?: { correlationId?: string }
  ): Promise<Result<ServiceRecoveryCase, FeedbackServiceErrorResult>> {
    const complaint = await this.complaintRepo.findById(complaintId, tenantId);
    if (!complaint) {
      return err({
        code: FeedbackServiceError.COMPLAINT_NOT_FOUND,
        message: 'Complaint not found',
      });
    }

    const existingCase = await this.serviceRecoveryRepo.findByComplaint(complaintId, complaint.tenantId);
    if (existingCase) {
      return ok(existingCase);
    }

    const id = asServiceRecoveryCaseId(`src_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();

    const case_: ServiceRecoveryCase = {
      id,
      complaintId,
      tenantId: complaint.tenantId,
      customerId: complaint.customerId,
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.serviceRecoveryRepo.create(case_);

    const event: ServiceRecoveryCaseCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'ServiceRecoveryCaseCreated',
      timestamp: now,
      tenantId: complaint.tenantId,
      correlationId: options?.correlationId ?? complaintId,
      causationId: null,
      metadata: {},
      payload: {
        caseId: saved.id,
        complaintId,
        customerId: complaint.customerId,
        triggerReason: 'low_rating_or_negative_sentiment',
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ServiceRecoveryCase'));

    return ok(saved);
  }

  /**
   * Resolve a service recovery case
   */
  async resolveServiceRecoveryCase(
    caseId: ServiceRecoveryCaseId,
    tenantId: TenantId,
    resolution: string,
    resolvedBy: UserId,
    options?: { correlationId?: string }
  ): Promise<Result<ServiceRecoveryCase, FeedbackServiceErrorResult>> {
    const case_ = await this.serviceRecoveryRepo.findById(caseId, tenantId);
    if (!case_) {
      return err({
        code: FeedbackServiceError.CASE_NOT_FOUND,
        message: 'Service recovery case not found',
      });
    }

    const now = new Date().toISOString();

    const updatedCase: ServiceRecoveryCase = {
      ...case_,
      status: 'resolved',
      resolution,
      resolvedAt: now,
      resolvedBy,
      updatedAt: now,
    };

    const saved = await this.serviceRecoveryRepo.update(updatedCase);

    const complaint = await this.complaintRepo.findById(case_.complaintId, case_.tenantId);
    if (complaint) {
      const updatedComplaint: Complaint = {
        ...complaint,
        status: 'resolved',
        updatedAt: now,
      };
      await this.complaintRepo.update(updatedComplaint);
    }

    const event: ServiceRecoveryCaseResolvedEvent = {
      eventId: generateEventId(),
      eventType: 'ServiceRecoveryCaseResolved',
      timestamp: now,
      tenantId: case_.tenantId,
      correlationId: options?.correlationId ?? caseId,
      causationId: null,
      metadata: {},
      payload: {
        caseId: saved.id,
        complaintId: case_.complaintId,
        customerId: case_.customerId,
        resolution,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ServiceRecoveryCase'));

    return ok(saved);
  }

  /**
   * Get sentiment trend for a customer
   */
  async getTenantSentimentTrend(
    customerId: CustomerId,
    tenantId: TenantId,
    period: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<SentimentTrend> {
    const responses = await this.feedbackResponseRepo.findManyByCustomer(
      customerId,
      tenantId,
      period
    );
    const complaints = await this.complaintRepo.findByCustomer(customerId, tenantId);

    const dataPoints: SentimentDataPoint[] = [];

    for (const r of responses) {
      if (r.sentimentAnalysis) {
        dataPoints.push({
          timestamp: r.submittedAt,
          score: r.sentimentAnalysis.score,
          label: r.sentimentAnalysis.label,
          source: 'feedback',
        });
      }
    }

    for (const c of complaints) {
      if (c.sentimentAnalysis) {
        dataPoints.push({
          timestamp: c.createdAt,
          score: c.sentimentAnalysis.score,
          label: c.sentimentAnalysis.label,
          source: 'complaint',
        });
      }
    }

    dataPoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const averageScore =
      dataPoints.length > 0
        ? dataPoints.reduce((sum, p) => sum + p.score, 0) / dataPoints.length
        : 0;

    let trend: SentimentTrend['trend'] = 'stable';
    if (dataPoints.length >= 2) {
      const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
      const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
      const firstAvg = firstHalf.reduce((s, p) => s + p.score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, p) => s + p.score, 0) / secondHalf.length;
      if (secondAvg > firstAvg + 0.1) trend = 'improving';
      else if (secondAvg < firstAvg - 0.1) trend = 'declining';
    }

    return {
      customerId,
      tenantId,
      period,
      dataPoints,
      averageScore,
      trend,
    };
  }

  /**
   * Get NPS score for tenant in period
   */
  async getNPSScore(
    tenantId: TenantId,
    period: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<NPSScore> {
    const responses = await this.feedbackResponseRepo.findManyByTenant(tenantId, period);
    const npsResponses = responses.filter((r) => r.npsScore !== undefined);

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of npsResponses) {
      const score = r.npsScore ?? 0;
      if (score >= 9) promoters++;
      else if (score >= 7) passives++;
      else detractors++;
    }

    const total = promoters + passives + detractors;
    const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return {
      tenantId,
      period,
      score: npsScore,
      responseCount: total,
      promoters,
      passives,
      detractors,
    };
  }

  /**
   * Get comprehensive feedback analytics
   */
  async getFeedbackAnalytics(
    tenantId: TenantId,
    period: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<FeedbackAnalytics> {
    const [responses, npsScore] = await Promise.all([
      this.feedbackResponseRepo.findManyByTenant(tenantId, period),
      this.getNPSScore(tenantId, period),
    ]);

    const avgRating =
      responses.length > 0
        ? responses.reduce((sum, r) => sum + r.rating, 0) / responses.length
        : 0;

    const categoryCounts: Record<string, number> = {};
    const sentimentDataPoints: SentimentDataPoint[] = [];

    for (const r of responses) {
      if (r.sentimentAnalysis) {
        sentimentDataPoints.push({
          timestamp: r.submittedAt,
          score: r.sentimentAnalysis.score,
          label: r.sentimentAnalysis.label,
          source: 'feedback',
        });
      }
    }

    const sentimentTrend: SentimentTrend = {
      customerId: '' as CustomerId,
      tenantId,
      period,
      dataPoints: sentimentDataPoints,
      averageScore:
        sentimentDataPoints.length > 0
          ? sentimentDataPoints.reduce((s, p) => s + p.score, 0) / sentimentDataPoints.length
          : 0,
      trend: 'stable',
    };

    const topCategories = Object.entries(categoryCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      tenantId,
      period,
      averageRating: avgRating,
      totalResponses: responses.length,
      npsScore,
      sentimentTrend,
      complaintCount: 0,
      serviceRecoveryCount: 0,
      topCategories: topCategories.length > 0 ? topCategories : [],
    };
  }

  // ==================== Private Helpers ====================

  private getExpiryForType(type: FeedbackType): ISOTimestamp | null {
    const now = new Date();
    switch (type) {
      case 'post_maintenance':
        now.setDate(now.getDate() + 7);
        break;
      case 'post_move_in':
        now.setDate(now.getDate() + 14);
        break;
      case 'periodic_nps':
        now.setDate(now.getDate() + 21);
        break;
      case 'exit_survey':
        now.setDate(now.getDate() + 30);
        break;
      default:
        now.setDate(now.getDate() + 14);
    }
    return now.toISOString();
  }

  private async applyEscalationRules(
    request: FeedbackRequest,
    response: FeedbackResponse
  ): Promise<void> {
    const rating = response.rating;
    const maxRating = request.type === 'periodic_nps' ? 10 : 5;
    const normalizedRating = maxRating === 10 ? rating / 2 : rating;

    // Rule 1: Low rating (< 3/5) → auto-create service recovery case
    if (normalizedRating < ESCALATION_RULES.LOW_RATING_THRESHOLD) {
      const complaint = await this.submitComplaint(
        request.tenantId,
        request.customerId,
        'other',
        response.comment ?? `Low rating: ${rating}/${maxRating}`,
        { sourceFeedbackId: response.id, sourceRequestId: request.id }
      );

      if (complaint.success) {
        await this.createServiceRecoveryCase(complaint.data.id, request.tenantId);
      }
    }

    // Rule 2: Negative sentiment in comment → flags for review (create complaint)
    if (response.sentimentAnalysis && response.sentimentAnalysis.score < ESCALATION_RULES.NEGATIVE_SENTIMENT_THRESHOLD) {
      const complaint = await this.submitComplaint(
        request.tenantId,
        request.customerId,
        'other',
        response.comment ?? `Negative sentiment detected (score: ${response.sentimentAnalysis.score})`,
        { sourceFeedbackId: response.id, sourceRequestId: request.id }
      );

      if (complaint.success) {
        await this.publishComplaintEscalatedEvent(complaint.data, 'negative_sentiment');
      }
    }
  }

  private inferSeverity(
    _description: string,
    sentiment: SentimentAnalysis | null
  ): Complaint['severity'] {
    if (sentiment && sentiment.score < -0.5) return 'high';
    if (sentiment && sentiment.score < 0) return 'medium';
    return 'low';
  }

  private async publishComplaintEscalatedEvent(
    complaint: Complaint,
    reason: ComplaintEscalatedEvent['payload']['reason'],
    correlationId?: string
  ): Promise<void> {
    const event: ComplaintEscalatedEvent = {
      eventId: generateEventId(),
      eventType: 'ComplaintEscalated',
      timestamp: new Date().toISOString(),
      tenantId: complaint.tenantId,
      correlationId: correlationId ?? complaint.id,
      causationId: null,
      metadata: {},
      payload: {
        complaintId: complaint.id,
        customerId: complaint.customerId,
        reason,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, complaint.id, 'Complaint'));
  }
}

// Re-export memory repositories for testing/development
export {
  InMemoryFeedbackRequestRepository,
  InMemoryFeedbackResponseRepository,
  InMemoryComplaintRepository,
  InMemoryServiceRecoveryCaseRepository,
} from './memory-repositories.js';
