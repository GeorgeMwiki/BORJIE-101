/**
 * Human-in-the-Loop Review Service
 * 
 * Manages the review workflow for AI-generated outputs.
 * Enforces review requirements based on risk level and confidence.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ReviewId,
  CopilotRequestId,
  CopilotRequestStatus,
  RiskLevel,
  ConfidenceLevel,
  AIActor,
  AIResult,
  AIError,
  HumanReview,
  aiOk,
  aiErr,
  asReviewId,
} from '../types/core.types.js';

/**
 * Review not found error
 */
export interface ReviewNotFoundError extends AIError {
  code: 'REVIEW_NOT_FOUND';
  reviewId: string;
}

/**
 * Review not required error
 */
export interface ReviewNotRequiredError extends AIError {
  code: 'REVIEW_NOT_REQUIRED';
  reason: string;
}

export type ReviewServiceError = ReviewNotFoundError | ReviewNotRequiredError;

/**
 * Review requirement determination
 */
export interface ReviewRequirement {
  required: boolean;
  reason: string;
  suggestedReviewers?: string[];
  escalationRequired?: boolean;
  escalationReason?: string;
}

/**
 * Review decision input
 */
export interface ReviewDecisionInput {
  copilotRequestId: CopilotRequestId;
  decision: 'approved' | 'rejected' | 'modified';
  modifications?: Record<string, unknown>;
  feedback?: string;
  qualityRating?: number;
}

/**
 * Pending review item
 */
export interface PendingReviewItem {
  copilotRequestId: CopilotRequestId;
  domain: string;
  riskLevel: RiskLevel;
  confidenceLevel: ConfidenceLevel;
  createdAt: string;
  outputSummary: string;
  suggestedReviewers: string[];
}

/**
 * Review policy configuration
 */
export interface ReviewPolicyConfig {
  /** Auto-approve low-risk items with high confidence */
  autoApproveLowRisk: boolean;
  /** Minimum confidence for auto-approval */
  autoApprovalMinConfidence: ConfidenceLevel;
  /** Require escalation for critical risk */
  escalateCriticalRisk: boolean;
  /** Maximum pending reviews before alerting */
  maxPendingReviews: number;
  /** Review SLA in hours by risk level */
  reviewSlaHours: Record<RiskLevel, number>;
}

const DEFAULT_REVIEW_POLICY: ReviewPolicyConfig = {
  autoApproveLowRisk: true,
  autoApprovalMinConfidence: ConfidenceLevel.HIGH,
  escalateCriticalRisk: true,
  maxPendingReviews: 50,
  reviewSlaHours: {
    [RiskLevel.LOW]: 48,
    [RiskLevel.MEDIUM]: 24,
    [RiskLevel.HIGH]: 8,
    [RiskLevel.CRITICAL]: 2,
  },
};

/**
 * Review storage backend interface
 */
export interface ReviewStorageBackend {
  saveReview(review: HumanReview): Promise<void>;
  getReview(id: ReviewId): Promise<HumanReview | null>;
  getReviewsForRequest(copilotRequestId: CopilotRequestId): Promise<HumanReview[]>;
  getPendingReviews(tenantId: string): Promise<PendingReviewItem[]>;
  getReviewMetrics(tenantId: string, startDate: Date, endDate: Date): Promise<ReviewMetrics>;
}

/**
 * Review metrics
 */
export interface ReviewMetrics {
  totalReviews: number;
  approvalRate: number;
  rejectionRate: number;
  modificationRate: number;
  avgReviewTimeSeconds: number;
  avgQualityRating: number;
  reviewsByRiskLevel: Record<RiskLevel, number>;
  slaComplianceRate: number;
}

/**
 * In-memory review storage for development
 */
export class InMemoryReviewStorage implements ReviewStorageBackend {
  private reviews: Map<string, HumanReview> = new Map();
  private pendingItems: Map<string, PendingReviewItem[]> = new Map();

  async saveReview(review: HumanReview): Promise<void> {
    this.reviews.set(review.id, review);
  }

  async getReview(id: ReviewId): Promise<HumanReview | null> {
    return this.reviews.get(id) ?? null;
  }

  async getReviewsForRequest(copilotRequestId: CopilotRequestId): Promise<HumanReview[]> {
    return Array.from(this.reviews.values()).filter(
      r => r.copilotRequestId === copilotRequestId
    );
  }

  async getPendingReviews(tenantId: string): Promise<PendingReviewItem[]> {
    return this.pendingItems.get(tenantId) ?? [];
  }

  async getReviewMetrics(tenantId: string, startDate: Date, endDate: Date): Promise<ReviewMetrics> {
    const reviews = Array.from(this.reviews.values()).filter(
      r => new Date(r.reviewedAt) >= startDate && new Date(r.reviewedAt) <= endDate
    );

    const total = reviews.length || 1;
    const approved = reviews.filter(r => r.decision === 'approved').length;
    const rejected = reviews.filter(r => r.decision === 'rejected').length;
    const modified = reviews.filter(r => r.decision === 'modified').length;

    return {
      totalReviews: reviews.length,
      approvalRate: approved / total,
      rejectionRate: rejected / total,
      modificationRate: modified / total,
      avgReviewTimeSeconds: reviews.reduce((sum, r) => sum + r.reviewTimeSeconds, 0) / total,
      avgQualityRating: reviews.reduce((sum, r) => sum + (r.qualityRating ?? 0), 0) / total,
      reviewsByRiskLevel: {
        [RiskLevel.LOW]: 0,
        [RiskLevel.MEDIUM]: 0,
        [RiskLevel.HIGH]: 0,
        [RiskLevel.CRITICAL]: 0,
      },
      slaComplianceRate: 0.95, // Placeholder
    };
  }

  addPendingItem(tenantId: string, item: PendingReviewItem): void {
    const items = this.pendingItems.get(tenantId) ?? [];
    items.push(item);
    this.pendingItems.set(tenantId, items);
  }

  removePendingItem(tenantId: string, copilotRequestId: CopilotRequestId): void {
    const items = this.pendingItems.get(tenantId) ?? [];
    this.pendingItems.set(
      tenantId,
      items.filter(i => i.copilotRequestId !== copilotRequestId)
    );
  }
}

/**
 * Human-in-the-Loop Review Service
 */
export class ReviewService {
  private storage: ReviewStorageBackend;
  private policy: ReviewPolicyConfig;
  private confidenceLevelOrder: ConfidenceLevel[] = [
    ConfidenceLevel.VERY_LOW,
    ConfidenceLevel.LOW,
    ConfidenceLevel.MEDIUM,
    ConfidenceLevel.HIGH,
    ConfidenceLevel.VERY_HIGH,
  ];

  constructor(
    storage?: ReviewStorageBackend,
    policy?: Partial<ReviewPolicyConfig>
  ) {
    this.storage = storage ?? new InMemoryReviewStorage();
    this.policy = { ...DEFAULT_REVIEW_POLICY, ...policy };
  }

  /**
   * Determine if review is required for a given output
   */
  determineReviewRequirement(
    riskLevel: RiskLevel,
    confidenceLevel: ConfidenceLevel,
    domain: string
  ): ReviewRequirement {
    // Critical risk always requires review and escalation
    if (riskLevel === RiskLevel.CRITICAL) {
      return {
        required: true,
        reason: 'Critical risk level requires mandatory human review',
        escalationRequired: this.policy.escalateCriticalRisk,
        escalationReason: 'Critical risk items require senior review',
        suggestedReviewers: ['senior-manager', 'compliance-officer'],
      };
    }

    // High risk always requires review
    if (riskLevel === RiskLevel.HIGH) {
      return {
        required: true,
        reason: 'High risk level requires human review',
        suggestedReviewers: ['property-manager', 'senior-agent'],
      };
    }

    // Medium risk: review unless high confidence
    if (riskLevel === RiskLevel.MEDIUM) {
      const confidenceIndex = this.confidenceLevelOrder.indexOf(confidenceLevel);
      const thresholdIndex = this.confidenceLevelOrder.indexOf(ConfidenceLevel.HIGH);
      
      if (confidenceIndex >= thresholdIndex) {
        return {
          required: false,
          reason: 'Medium risk with high confidence - auto-approval eligible',
        };
      }
      return {
        required: true,
        reason: 'Medium risk with lower confidence requires review',
        suggestedReviewers: ['agent', 'property-manager'],
      };
    }

    // Low risk: auto-approve if policy allows and confidence is sufficient
    if (riskLevel === RiskLevel.LOW && this.policy.autoApproveLowRisk) {
      const confidenceIndex = this.confidenceLevelOrder.indexOf(confidenceLevel);
      const thresholdIndex = this.confidenceLevelOrder.indexOf(this.policy.autoApprovalMinConfidence);
      
      if (confidenceIndex >= thresholdIndex) {
        return {
          required: false,
          reason: 'Low risk with sufficient confidence - auto-approved',
        };
      }
    }

    return {
      required: true,
      reason: 'Review required based on policy',
      suggestedReviewers: ['agent'],
    };
  }

  /**
   * Submit a review decision
   */
  async submitReview(
    input: ReviewDecisionInput,
    reviewer: AIActor,
    reviewStartTime: Date
  ): Promise<AIResult<HumanReview, ReviewServiceError>> {
    const reviewEndTime = new Date();
    const reviewTimeSeconds = Math.floor(
      (reviewEndTime.getTime() - reviewStartTime.getTime()) / 1000
    );

    const review: HumanReview = {
      id: asReviewId(uuidv4()),
      copilotRequestId: input.copilotRequestId,
      reviewer,
      decision: input.decision,
      modifications: input.modifications,
      feedback: input.feedback,
      qualityRating: input.qualityRating,
      reviewTimeSeconds,
      reviewedAt: reviewEndTime.toISOString(),
    };

    await this.storage.saveReview(review);
    return aiOk(review);
  }

  /**
   * Get pending reviews for a tenant
   */
  async getPendingReviews(tenantId: string): Promise<PendingReviewItem[]> {
    return this.storage.getPendingReviews(tenantId);
  }

  /**
   * Get review history for a copilot request
   */
  async getReviewHistory(copilotRequestId: CopilotRequestId): Promise<HumanReview[]> {
    return this.storage.getReviewsForRequest(copilotRequestId);
  }

  /**
   * Get review metrics
   */
  async getMetrics(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ReviewMetrics> {
    return this.storage.getReviewMetrics(tenantId, startDate, endDate);
  }

  /**
   * Calculate SLA deadline for a review
   */
  calculateSlaDeadline(riskLevel: RiskLevel, createdAt: Date): Date {
    const slaHours = this.policy.reviewSlaHours[riskLevel];
    return new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);
  }

  /**
   * Check if a review is overdue
   */
  isReviewOverdue(riskLevel: RiskLevel, createdAt: Date): boolean {
    const deadline = this.calculateSlaDeadline(riskLevel, createdAt);
    return new Date() > deadline;
  }

  /**
   * Get overdue reviews for alerting
   */
  async getOverdueReviews(tenantId: string): Promise<PendingReviewItem[]> {
    const pending = await this.storage.getPendingReviews(tenantId);
    return pending.filter(item => 
      this.isReviewOverdue(item.riskLevel, new Date(item.createdAt))
    );
  }
}

/**
 * Factory function for creating review service
 */
export function createReviewService(
  storage?: ReviewStorageBackend,
  policy?: Partial<ReviewPolicyConfig>
): ReviewService {
  return new ReviewService(storage, policy);
}
