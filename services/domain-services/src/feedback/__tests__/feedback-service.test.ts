/**
 * Unit tests for FeedbackService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId, CustomerId } from '@borjie/domain-models';
import { asCustomerId } from '@borjie/domain-models';
import type {
  FeedbackRequestRepository,
  FeedbackResponseRepository,
  ComplaintRepository,
  ServiceRecoveryCaseRepository,
  FeedbackRequest,
  FeedbackResponse,
  Complaint,
  SentimentAnalysis,
} from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  FeedbackService,
  FeedbackServiceError,
  asFeedbackRequestId,
  type SentimentAnalysisProvider,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('FeedbackService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const customerId = asCustomerId('cust_1');
  const userId = 'usr_1' as UserId;

  describe('feedback submission', () => {
    it('submits feedback successfully', async () => {
      const request = {
        id: asFeedbackRequestId('fr_1'),
        tenantId,
        customerId,
        type: 'post_maintenance',
        context: { workOrderId: 'wo_1' },
        channel: 'whatsapp',
        status: 'sent',
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: '',
        updatedAt: '',
      } as FeedbackRequest;

      const response = {
        id: 'fresp_1' as any,
        requestId: request.id,
        tenantId,
        customerId,
        rating: 4,
        comment: 'Quick and professional service',
        sentimentAnalysis: null,
        submittedAt: new Date().toISOString(),
        metadata: {},
      };

      const feedbackRequestRepo: Partial<FeedbackRequestRepository> = {
        findById: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockImplementation((r) => Promise.resolve(r)),
      };

      const feedbackResponseRepo: Partial<FeedbackResponseRepository> = {
        create: vi.fn().mockResolvedValue(response),
      };

      const mockSentimentProvider: SentimentAnalysisProvider = {
        analyze: vi.fn().mockResolvedValue({
          score: 0.5,
          label: 'positive',
          confidence: 0.8,
          keyPhrases: [],
          emotionDensity: {},
          analyzedAt: new Date().toISOString(),
        } as SentimentAnalysis),
      };

      const service = new FeedbackService(
        feedbackRequestRepo as FeedbackRequestRepository,
        feedbackResponseRepo as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus(),
        mockSentimentProvider
      );

      const result = await service.submitFeedback(
        request.id,
        tenantId,
        4,
        'Quick and professional service'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rating).toBe(4);
        expect(result.data.comment).toBe('Quick and professional service');
      }
      expect(feedbackResponseRepo.create).toHaveBeenCalled();
      expect(feedbackRequestRepo.update).toHaveBeenCalled();
    });

    it('returns error when feedback request not found', async () => {
      const feedbackRequestRepo: Partial<FeedbackRequestRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const service = new FeedbackService(
        feedbackRequestRepo as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus()
      );

      const result = await service.submitFeedback(
        asFeedbackRequestId('fr_nonexistent'),
        tenantId,
        4,
        null
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FeedbackServiceError.FEEDBACK_REQUEST_NOT_FOUND);
      }
    });

    it('returns error when feedback already submitted', async () => {
      const request = {
        id: asFeedbackRequestId('fr_1'),
        tenantId,
        customerId,
        type: 'post_maintenance',
        context: {},
        channel: 'whatsapp',
        status: 'responded',
        sentAt: '',
        expiresAt: null,
        createdAt: '',
        updatedAt: '',
      } as FeedbackRequest;

      const feedbackRequestRepo: Partial<FeedbackRequestRepository> = {
        findById: vi.fn().mockResolvedValue(request),
      };

      const service = new FeedbackService(
        feedbackRequestRepo as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus()
      );

      const result = await service.submitFeedback(request.id, tenantId, 4, null);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FeedbackServiceError.FEEDBACK_ALREADY_SUBMITTED);
      }
    });

    it('returns error for invalid rating', async () => {
      const request = {
        id: asFeedbackRequestId('fr_1'),
        tenantId,
        customerId,
        type: 'post_maintenance',
        context: {},
        channel: 'whatsapp',
        status: 'sent',
        sentAt: '',
        expiresAt: null,
        createdAt: '',
        updatedAt: '',
      } as FeedbackRequest;

      const feedbackRequestRepo: Partial<FeedbackRequestRepository> = {
        findById: vi.fn().mockResolvedValue(request),
      };

      const service = new FeedbackService(
        feedbackRequestRepo as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus()
      );

      const result = await service.submitFeedback(request.id, tenantId, 15, null); // Invalid: max 5 for non-NPS

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FeedbackServiceError.INVALID_RATING);
      }
    });
  });

  describe('complaint escalation', () => {
    it('submits complaint and escalates when repeated', async () => {
      const complaint = {
        id: 'complaint_1' as any,
        tenantId,
        customerId,
        category: 'maintenance',
        description: 'Water still leaking after repair',
        severity: 'medium',
        status: 'escalated',
        sentimentAnalysis: null,
        evidenceAttachments: [],
        escalatedToManager: true,
        complaintCount: 3,
        createdAt: '',
        updatedAt: '',
      } as Complaint;

      const complaintRepo: Partial<ComplaintRepository> = {
        create: vi.fn().mockResolvedValue(complaint),
        countByCustomer: vi.fn().mockResolvedValue(2), // Already 2 complaints - triggers escalation
      };

      const mockSentimentProvider: SentimentAnalysisProvider = {
        analyze: vi.fn().mockResolvedValue({
          score: -0.3,
          label: 'negative',
          confidence: 0.7,
          keyPhrases: [],
          emotionDensity: {},
          analyzedAt: new Date().toISOString(),
        } as SentimentAnalysis),
      };

      const service = new FeedbackService(
        {} as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        complaintRepo as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus(),
        mockSentimentProvider
      );

      const result = await service.submitComplaint(
        tenantId,
        customerId,
        'maintenance',
        'Water still leaking after repair'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.escalatedToManager).toBe(true);
        expect(result.data.complaintCount).toBe(3);
      }
      expect(complaintRepo.create).toHaveBeenCalled();
    });
  });

  describe('sentiment analysis integration', () => {
    it('analyzes sentiment successfully', async () => {
      const mockSentiment: SentimentAnalysis = {
        score: 0.5,
        label: 'positive',
        confidence: 0.85,
        keyPhrases: ['great service', 'professional'],
        emotionDensity: {},
        analyzedAt: new Date().toISOString(),
      };

      const mockSentimentProvider: SentimentAnalysisProvider = {
        analyze: vi.fn().mockResolvedValue(mockSentiment),
      };

      const service = new FeedbackService(
        {} as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus(),
        mockSentimentProvider
      );

      const result = await service.analyzeSentiment('The service was great and very professional!');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.score).toBe(0.5);
        expect(result.data.label).toBe('positive');
        expect(result.data.confidence).toBe(0.85);
      }
      expect(mockSentimentProvider.analyze).toHaveBeenCalledWith(
        'The service was great and very professional!'
      );
    });

    it('returns error when sentiment analysis fails', async () => {
      const mockSentimentProvider: SentimentAnalysisProvider = {
        analyze: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      };

      const service = new FeedbackService(
        {} as FeedbackRequestRepository,
        {} as FeedbackResponseRepository,
        {} as ComplaintRepository,
        {} as ServiceRecoveryCaseRepository,
        createMockEventBus(),
        mockSentimentProvider
      );

      const result = await service.analyzeSentiment('Some text');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(FeedbackServiceError.SENTIMENT_ANALYSIS_FAILED);
      }
    });
  });
});
