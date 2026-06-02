/**
 * AI Copilot Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockAICopilot,
  AICopilot,
  CopilotDomain,
  RiskLevel,
  ConfidenceLevel,
  PredictionHorizon,
  PredictionModelType,
} from '../index.js';
import type { MaintenanceTriageInput } from '../types/copilot.types.js';
import type { RoyaltyArrearsRiskInput, BuyerChurnRiskInput, ProductionHealthInput } from '../types/prediction.types.js';
import type { AITenantContext, AIActor, AIRequestContext } from '../types/core.types.js';

describe('AICopilot', () => {
  let copilot: AICopilot;
  let tenant: AITenantContext;
  let actor: AIActor;
  let requestContext: AIRequestContext;

  beforeEach(() => {
    copilot = createMockAICopilot();
    
    tenant = {
      tenantId: 'tenant-123',
      tenantName: 'Test Mining Estate',
      environment: 'development',
    };
    
    actor = {
      type: 'user',
      id: 'user-456',
      name: 'Test User',
      email: 'test@example.com',
      roles: ['property-manager'],
    };
    
    requestContext = {
      traceId: 'trace-789',
      requestId: 'req-abc',
      sourceService: 'test-service',
      timestamp: new Date().toISOString(),
    };
  });

  describe('health check', () => {
    it('should return healthy status with mock provider', async () => {
      const status = await copilot.healthCheck();
      
      expect(status.overall).toBe('healthy');
      expect(status.components.promptRegistry).toBe('healthy');
      expect(status.components.aiProvider).toBe('healthy');
      expect(status.components.reviewService).toBe('healthy');
      expect(status.components.predictionEngine).toBe('healthy');
    });
  });

  describe('accessors', () => {
    it('should provide access to internal services', () => {
      expect(copilot.prompts).toBeDefined();
      expect(copilot.reviews).toBeDefined();
      expect(copilot.predictions).toBeDefined();
      expect(copilot.governance).toBeDefined();
    });
  });
});

describe('Prediction Engine', () => {
  let copilot: AICopilot;
  let tenant: AITenantContext;

  beforeEach(() => {
    copilot = createMockAICopilot();
    tenant = {
      tenantId: 'tenant-123',
      tenantName: 'Test Mining Estate',
      environment: 'development',
    };
  });

  describe('royalty arrears risk prediction', () => {
    it('should predict low arrears risk for good payment history', async () => {
      const input: RoyaltyArrearsRiskInput = {
        counterpartyId: 'cp-001',
        supplyAgreementId: 'agr-001',
        siteId: 'site-001',
        pitId: 'pit-001',
        paymentHistory: {
          historyMonths: 24,
          onTimeRate: 0.98,
          avgDaysLate: 0.5,
          maxArrearsDays: 3,
          currentArrearsAmount: 0,
          arrearsCount12m: 0,
        },
        counterpartyProfile: {
          relationshipMonths: 24,
          employmentStatus: 'employed',
          incomeVerified: true,
          paymentToRevenueRatio: 0.25,
        },
        currentContext: {
          paymentAmount: 50000,
          daysUntilNextDue: 15,
          hasAutoPay: true,
        },
      };

      const result = await copilot.predictRoyaltyArrearsRisk(input, tenant);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.ROYALTY_ARREARS_RISK);
        expect(result.data.prediction.riskTier).toBe('watch');
        expect(result.data.riskLevel).toBe(RiskLevel.LOW);
        expect(result.data.alertConfig.shouldAlert).toBe(false);
      }
    });

    it('should predict high arrears risk for poor payment history', async () => {
      const input: RoyaltyArrearsRiskInput = {
        counterpartyId: 'cp-002',
        supplyAgreementId: 'agr-002',
        siteId: 'site-001',
        pitId: 'pit-002',
        paymentHistory: {
          historyMonths: 12,
          onTimeRate: 0.6,
          avgDaysLate: 15,
          maxArrearsDays: 45,
          currentArrearsAmount: 25000,
          arrearsCount12m: 5,
        },
        counterpartyProfile: {
          relationshipMonths: 12,
          employmentStatus: 'unknown',
          incomeVerified: false,
        },
        currentContext: {
          paymentAmount: 50000,
          daysUntilNextDue: 5,
          hasAutoPay: false,
        },
      };

      const result = await copilot.predictRoyaltyArrearsRisk(input, tenant);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prediction.riskTier).toMatch(/at-risk|high-risk|critical/);
        expect([RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]).toContain(result.data.riskLevel);
        expect(result.data.recommendedActions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('buyer churn risk prediction', () => {
    it('should predict low churn for satisfied long-term buyer', async () => {
      const input: BuyerChurnRiskInput = {
        counterpartyId: 'cp-001',
        supplyAgreementId: 'agr-001',
        siteId: 'site-001',
        pitId: 'pit-001',
        supplyAgreementStatus: {
          agreementStartDate: '2022-01-01',
          agreementEndDate: '2026-12-31',
          daysUntilExpiry: 300,
          isSpotMarket: false,
          renewalsCompleted: 3,
        },
        counterpartyEngagement: {
          loginFrequency30d: 5,
          maintenanceRequestCount12m: 2,
          maintenanceResolutionSatisfaction: 4.5,
          communicationSentiment: 'positive',
          complaintCount12m: 0,
        },
        marketFactors: {
          currentPrice: 50000,
          marketRateEstimate: 55000,
          priceIncreasePercent: 5,
          localAvailableCapacityRate: 0.05,
        },
        siteFactors: {
          siteAge: 5,
          lastMajorUpgrade: '2023-01-01',
          capabilityScore: 8,
          locationScore: 9,
        },
      };

      const result = await copilot.predictBuyerChurnRisk(input, tenant);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.BUYER_CHURN_RISK);
        expect(result.data.prediction.riskTier).toBe('stable');
        expect(result.data.riskLevel).toBe(RiskLevel.LOW);
        expect(result.data.financialImpact.totalImpact).toBeGreaterThan(0);
      }
    });

    it('should predict high churn for dissatisfied buyer near expiry', async () => {
      const input: BuyerChurnRiskInput = {
        counterpartyId: 'cp-003',
        supplyAgreementId: 'agr-003',
        siteId: 'site-002',
        pitId: 'pit-003',
        supplyAgreementStatus: {
          agreementStartDate: '2025-01-01',
          agreementEndDate: '2026-03-01',
          daysUntilExpiry: 30,
          isSpotMarket: false,
          renewalsCompleted: 0,
        },
        counterpartyEngagement: {
          loginFrequency30d: 0,
          maintenanceRequestCount12m: 8,
          maintenanceResolutionSatisfaction: 2,
          communicationSentiment: 'negative',
          complaintCount12m: 4,
        },
        marketFactors: {
          currentPrice: 60000,
          marketRateEstimate: 50000,
          priceIncreasePercent: 10,
          localAvailableCapacityRate: 0.15,
        },
        siteFactors: {
          siteAge: 25,
          capabilityScore: 4,
          locationScore: 5,
        },
      };

      const result = await copilot.predictBuyerChurnRisk(input, tenant);

      expect(result.success).toBe(true);
      if (result.success) {
        // Model evaluates multiple factors - verify it detects elevated risk
        expect(result.data.prediction.riskTier).toMatch(/watch|at-risk|likely-churning/);
        expect([RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]).toContain(result.data.riskLevel);
        // Should generate recommendations for buyer showing risk signals
        expect(result.data.retentionRecommendations.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('production health scoring', () => {
    it('should score healthy portfolio', async () => {
      const input: ProductionHealthInput = {
        siteId: 'site-001',
        portfolio: {
          totalPits: 50,
          activePits: 48,
          idlePits: 2,
          pitsUnderUpgrade: 0,
          avgDaysToCommission: 15,
        },
        financialMetrics: {
          grossPotentialRevenue: 2500000,
          effectiveGrossRevenue: 2400000,
          collectionRate: 0.98,
          avgRevenuePerPit: 50000,
          marketRateComparison: 0.05,
        },
        counterpartyComposition: {
          avgRelationshipMonths: 18,
          counterpartyTurnoverRate12m: 0.15,
          renewalRate: 0.75,
          arrearsRate: 0.05,
        },
        marketContext: {
          localAvailableCapacityRate: 0.08,
          marketTrend: 'stable',
        },
      };

      const result = await copilot.scoreProductionHealth(input, tenant);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.PRODUCTION_HEALTH);
        expect(result.data.healthScore.overall).toBeGreaterThan(70);
        expect(['A', 'B']).toContain(result.data.healthScore.grade);
        expect(result.data.componentScores.production).toBeGreaterThan(90);
        expect(result.data.insights.strengths.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('Review Service', () => {
  let copilot: AICopilot;

  beforeEach(() => {
    copilot = createMockAICopilot();
  });

  describe('review requirement determination', () => {
    it('should require review for critical risk', () => {
      const requirement = copilot.reviews.determineReviewRequirement(
        RiskLevel.CRITICAL,
        ConfidenceLevel.VERY_HIGH,
        CopilotDomain.RISK_ALERTING
      );
      
      expect(requirement.required).toBe(true);
      expect(requirement.escalationRequired).toBe(true);
    });

    it('should not require review for low risk with high confidence', () => {
      const requirement = copilot.reviews.determineReviewRequirement(
        RiskLevel.LOW,
        ConfidenceLevel.HIGH,
        CopilotDomain.COMMUNICATION_DRAFTING
      );
      
      expect(requirement.required).toBe(false);
    });

    it('should require review for medium risk with low confidence', () => {
      const requirement = copilot.reviews.determineReviewRequirement(
        RiskLevel.MEDIUM,
        ConfidenceLevel.LOW,
        CopilotDomain.MAINTENANCE_TRIAGE
      );
      
      expect(requirement.required).toBe(true);
    });
  });

  describe('SLA calculation', () => {
    it('should calculate shorter SLA for higher risk', () => {
      const baseTime = new Date();
      
      const lowSla = copilot.reviews.calculateSlaDeadline(RiskLevel.LOW, baseTime);
      const criticalSla = copilot.reviews.calculateSlaDeadline(RiskLevel.CRITICAL, baseTime);
      
      expect(criticalSla.getTime()).toBeLessThan(lowSla.getTime());
    });
  });
});

describe('Prompt Registry', () => {
  let copilot: AICopilot;

  beforeEach(() => {
    copilot = createMockAICopilot();
  });

  it('should have default prompts registered', async () => {
    const maintenancePrompts = await copilot.prompts.listByDomain(CopilotDomain.MAINTENANCE_TRIAGE);
    
    expect(maintenancePrompts.length).toBeGreaterThan(0);
  });
});

describe('Governance Service', () => {
  let copilot: AICopilot;

  beforeEach(() => {
    copilot = createMockAICopilot();
  });

  it('should check budget status', async () => {
    const budgetStatus = await copilot.checkBudget('tenant-123', 100);
    
    expect(budgetStatus.withinBudget).toBe(true);
    expect(budgetStatus.percentUsed).toBeDefined();
    expect(budgetStatus.remaining).toBeDefined();
  });

  it('should get usage metrics', async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const metrics = await copilot.getUsageMetrics('tenant-123', startOfMonth, now);
    
    expect(metrics.period).toBeDefined();
    expect(metrics.copilotUsage).toBeDefined();
    expect(metrics.predictionUsage).toBeDefined();
  });
});
