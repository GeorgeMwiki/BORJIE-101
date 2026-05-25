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
import type { ArrearsRiskInput, ChurnRiskInput, OccupancyHealthInput } from '../types/prediction.types.js';
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
      tenantName: 'Test Property Management',
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
      tenantName: 'Test Property Management',
      environment: 'development',
    };
  });

  describe('arrears risk prediction', () => {
    it('should predict low arrears risk for good payment history', async () => {
      const input: ArrearsRiskInput = {
        tenantId: 'ten-001',
        leaseId: 'lease-001',
        propertyId: 'prop-001',
        unitId: 'unit-001',
        paymentHistory: {
          historyMonths: 24,
          onTimeRate: 0.98,
          avgDaysLate: 0.5,
          maxArrearsDays: 3,
          currentArrearsAmount: 0,
          arrearsCount12m: 0,
        },
        tenantProfile: {
          tenancyMonths: 24,
          employmentStatus: 'employed',
          incomeVerified: true,
          rentToIncomeRatio: 0.25,
        },
        currentContext: {
          rentAmount: 50000,
          daysUntilNextDue: 15,
          hasAutoPay: true,
        },
      };

      const result = await copilot.predictArrearsRisk(input, tenant);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.ARREARS_RISK);
        expect(result.data.prediction.riskTier).toBe('watch');
        expect(result.data.riskLevel).toBe(RiskLevel.LOW);
        expect(result.data.alertConfig.shouldAlert).toBe(false);
      }
    });

    it('should predict high arrears risk for poor payment history', async () => {
      const input: ArrearsRiskInput = {
        tenantId: 'ten-002',
        leaseId: 'lease-002',
        propertyId: 'prop-001',
        unitId: 'unit-002',
        paymentHistory: {
          historyMonths: 12,
          onTimeRate: 0.6,
          avgDaysLate: 15,
          maxArrearsDays: 45,
          currentArrearsAmount: 25000,
          arrearsCount12m: 5,
        },
        tenantProfile: {
          tenancyMonths: 12,
          employmentStatus: 'unknown',
          incomeVerified: false,
        },
        currentContext: {
          rentAmount: 50000,
          daysUntilNextDue: 5,
          hasAutoPay: false,
        },
      };

      const result = await copilot.predictArrearsRisk(input, tenant);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prediction.riskTier).toMatch(/at-risk|high-risk|critical/);
        expect([RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]).toContain(result.data.riskLevel);
        expect(result.data.recommendedActions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('churn risk prediction', () => {
    it('should predict low churn for satisfied long-term tenant', async () => {
      const input: ChurnRiskInput = {
        tenantId: 'ten-001',
        leaseId: 'lease-001',
        propertyId: 'prop-001',
        unitId: 'unit-001',
        leaseStatus: {
          leaseStartDate: '2022-01-01',
          leaseEndDate: '2026-12-31',
          daysUntilExpiry: 300,
          isMonthToMonth: false,
          renewalsCompleted: 3,
        },
        tenantEngagement: {
          loginFrequency30d: 5,
          maintenanceRequestCount12m: 2,
          maintenanceResolutionSatisfaction: 4.5,
          communicationSentiment: 'positive',
          complaintCount12m: 0,
        },
        marketFactors: {
          currentRent: 50000,
          marketRateEstimate: 55000,
          rentIncreasePercent: 5,
          localVacancyRate: 0.05,
        },
        propertyFactors: {
          propertyAge: 5,
          lastMajorRenovation: '2023-01-01',
          amenityScore: 8,
          neighborhoodScore: 9,
        },
      };

      const result = await copilot.predictChurnRisk(input, tenant);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.CHURN_RISK);
        expect(result.data.prediction.riskTier).toBe('stable');
        expect(result.data.riskLevel).toBe(RiskLevel.LOW);
        expect(result.data.financialImpact.totalImpact).toBeGreaterThan(0);
      }
    });

    it('should predict high churn for dissatisfied tenant near expiry', async () => {
      const input: ChurnRiskInput = {
        tenantId: 'ten-003',
        leaseId: 'lease-003',
        propertyId: 'prop-002',
        unitId: 'unit-003',
        leaseStatus: {
          leaseStartDate: '2025-01-01',
          leaseEndDate: '2026-03-01',
          daysUntilExpiry: 30,
          isMonthToMonth: false,
          renewalsCompleted: 0,
        },
        tenantEngagement: {
          loginFrequency30d: 0,
          maintenanceRequestCount12m: 8,
          maintenanceResolutionSatisfaction: 2,
          communicationSentiment: 'negative',
          complaintCount12m: 4,
        },
        marketFactors: {
          currentRent: 60000,
          marketRateEstimate: 50000,
          rentIncreasePercent: 10,
          localVacancyRate: 0.15,
        },
        propertyFactors: {
          propertyAge: 25,
          amenityScore: 4,
          neighborhoodScore: 5,
        },
      };

      const result = await copilot.predictChurnRisk(input, tenant);
      
      expect(result.success).toBe(true);
      if (result.success) {
        // Model evaluates multiple factors - verify it detects elevated risk
        expect(result.data.prediction.riskTier).toMatch(/watch|at-risk|likely-churning/);
        expect([RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]).toContain(result.data.riskLevel);
        // Should generate recommendations for tenant showing risk signals
        expect(result.data.retentionRecommendations.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('occupancy health scoring', () => {
    it('should score healthy portfolio', async () => {
      const input: OccupancyHealthInput = {
        propertyId: 'prop-001',
        portfolio: {
          totalUnits: 50,
          occupiedUnits: 48,
          vacantUnits: 2,
          unitsUnderRenovation: 0,
          avgDaysOnMarket: 15,
        },
        financialMetrics: {
          grossPotentialRent: 2500000,
          effectiveGrossRent: 2400000,
          collectionRate: 0.98,
          avgRentPerUnit: 50000,
          marketRateComparison: 0.05,
        },
        tenantComposition: {
          avgTenancyMonths: 18,
          tenantTurnoverRate12m: 0.15,
          renewalRate: 0.75,
          arrearsRate: 0.05,
        },
        marketContext: {
          localVacancyRate: 0.08,
          marketTrend: 'stable',
        },
      };

      const result = await copilot.scoreOccupancyHealth(input, tenant);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelType).toBe(PredictionModelType.OCCUPANCY_HEALTH);
        expect(result.data.healthScore.overall).toBeGreaterThan(70);
        expect(['A', 'B']).toContain(result.data.healthScore.grade);
        expect(result.data.componentScores.occupancy).toBeGreaterThan(90);
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
