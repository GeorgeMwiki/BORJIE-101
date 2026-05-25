/**
 * Prediction Engine
 * 
 * Core engine for running predictive models including:
 * - Arrears risk prediction
 * - Churn risk prediction
 * - Maintenance recurrence prediction
 * - Occupancy health scoring
 */

import { v4 as uuidv4 } from 'uuid';
import {
  PredictionId,
  RiskLevel,
  ConfidenceLevel,
  AITenantContext,
  AIResult,
  AIError,
  asPredictionId,
  scoreToConfidenceLevel,
  aiOk,
  aiErr,
} from '../types/core.types.js';
import {
  PredictionModelType,
  PredictionHorizon,
  PredictionBase,
  FeatureImportance,
  RecommendedAction,
  ArrearsRiskInput,
  ArrearsRiskPrediction,
  ChurnRiskInput,
  ChurnRiskPrediction,
  MaintenanceRecurrenceInput,
  MaintenanceRecurrencePrediction,
  OccupancyHealthInput,
  OccupancyHealthScore,
} from '../types/prediction.types.js';

/**
 * Prediction error
 */
export interface PredictionError extends AIError {
  code: 'PREDICTION_ERROR' | 'MODEL_ERROR' | 'INPUT_ERROR';
  modelType: PredictionModelType;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model version */
  version: string;
  /** Feature weights for scoring */
  featureWeights: Record<string, number>;
  /** Threshold configurations */
  thresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  /** Model-specific parameters */
  parameters: Record<string, unknown>;
}

/**
 * Prediction event listener
 */
export interface PredictionEventListener {
  onPredictionGenerated?(prediction: PredictionBase): void;
  onHighRiskDetected?(prediction: PredictionBase): void;
  onPredictionError?(error: PredictionError): void;
}

/**
 * Base prediction engine
 */
export class PredictionEngine {
  private modelConfigs: Map<PredictionModelType, ModelConfig> = new Map();
  private eventListeners: PredictionEventListener[] = [];

  constructor() {
    this.initializeDefaultConfigs();
  }

  /**
   * Initialize default model configurations
   */
  private initializeDefaultConfigs(): void {
    // Arrears risk model config
    this.modelConfigs.set(PredictionModelType.ARREARS_RISK, {
      version: '1.0.0',
      featureWeights: {
        onTimeRate: -0.4,
        avgDaysLate: 0.2,
        currentArrearsAmount: 0.3,
        rentToIncomeRatio: 0.15,
        hasAutoPay: -0.15,
        tenancyMonths: -0.1,
        arrearsCount12m: 0.2,
      },
      thresholds: { low: 0.2, medium: 0.4, high: 0.6, critical: 0.8 },
      parameters: {},
    });

    // Churn risk model config
    this.modelConfigs.set(PredictionModelType.CHURN_RISK, {
      version: '1.0.0',
      featureWeights: {
        daysUntilExpiry: -0.2,
        renewalsCompleted: -0.15,
        maintenanceSatisfaction: -0.2,
        complaintCount12m: 0.25,
        rentVsMarket: 0.2,
        loginFrequency: -0.1,
        communicationSentiment: -0.15,
      },
      thresholds: { low: 0.25, medium: 0.45, high: 0.65, critical: 0.85 },
      parameters: {},
    });

    // Maintenance recurrence model config
    this.modelConfigs.set(PredictionModelType.MAINTENANCE_RECURRENCE, {
      version: '1.0.0',
      featureWeights: {
        similarIssuesThisUnit: 0.35,
        similarIssuesProperty: 0.15,
        propertyAge: 0.15,
        systemAge: 0.2,
        seasonalPattern: 0.15,
      },
      thresholds: { low: 0.2, medium: 0.4, high: 0.6, critical: 0.8 },
      parameters: {},
    });

    // Occupancy health model config
    this.modelConfigs.set(PredictionModelType.OCCUPANCY_HEALTH, {
      version: '1.0.0',
      featureWeights: {
        occupancyRate: 0.3,
        collectionRate: 0.25,
        renewalRate: 0.2,
        marketPosition: 0.15,
        turnoverRate: -0.1,
      },
      thresholds: { low: 0.3, medium: 0.5, high: 0.7, critical: 0.85 },
      parameters: {},
    });
  }

  /**
   * Add event listener
   */
  addEventListener(listener: PredictionEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Predict arrears risk
   */
  async predictArrearsRisk(
    input: ArrearsRiskInput,
    tenant: AITenantContext,
    horizon: PredictionHorizon = PredictionHorizon.MONTH
  ): Promise<AIResult<ArrearsRiskPrediction, PredictionError>> {
    const config = this.modelConfigs.get(PredictionModelType.ARREARS_RISK)!;
    const predictionId = asPredictionId(uuidv4());

    try {
      // Calculate feature values
      const features: FeatureImportance[] = [];
      let riskScore = 0.5; // Base score

      // On-time payment rate (negative = lower risk)
      const onTimeContribution = config.featureWeights.onTimeRate * (1 - input.paymentHistory.onTimeRate);
      riskScore += onTimeContribution;
      features.push({
        feature: 'onTimeRate',
        displayName: 'On-Time Payment Rate',
        value: input.paymentHistory.onTimeRate,
        importance: Math.abs(config.featureWeights.onTimeRate),
        direction: input.paymentHistory.onTimeRate > 0.9 ? 'negative' : 'positive',
      });

      // Average days late
      const daysLateNormalized = Math.min(input.paymentHistory.avgDaysLate / 30, 1);
      const daysLateContribution = config.featureWeights.avgDaysLate * daysLateNormalized;
      riskScore += daysLateContribution;
      features.push({
        feature: 'avgDaysLate',
        displayName: 'Average Days Late',
        value: input.paymentHistory.avgDaysLate,
        importance: Math.abs(config.featureWeights.avgDaysLate),
        direction: input.paymentHistory.avgDaysLate > 5 ? 'positive' : 'negative',
      });

      // Current arrears
      const arrearsNormalized = Math.min(input.paymentHistory.currentArrearsAmount / input.currentContext.rentAmount, 2) / 2;
      const arrearsContribution = config.featureWeights.currentArrearsAmount * arrearsNormalized;
      riskScore += arrearsContribution;
      features.push({
        feature: 'currentArrearsAmount',
        displayName: 'Current Arrears',
        value: input.paymentHistory.currentArrearsAmount,
        importance: Math.abs(config.featureWeights.currentArrearsAmount),
        direction: input.paymentHistory.currentArrearsAmount > 0 ? 'positive' : 'negative',
      });

      // Auto-pay
      const autoPayContribution = input.currentContext.hasAutoPay ? config.featureWeights.hasAutoPay : 0;
      riskScore += autoPayContribution;
      features.push({
        feature: 'hasAutoPay',
        displayName: 'Auto-Pay Enabled',
        value: input.currentContext.hasAutoPay,
        importance: Math.abs(config.featureWeights.hasAutoPay),
        direction: input.currentContext.hasAutoPay ? 'negative' : 'positive',
      });

      // Clamp risk score
      riskScore = Math.max(0, Math.min(1, riskScore));

      // Determine risk tier
      let riskTier: 'watch' | 'at-risk' | 'high-risk' | 'critical';
      let riskLevel: RiskLevel;
      if (riskScore >= config.thresholds.critical) {
        riskTier = 'critical';
        riskLevel = RiskLevel.CRITICAL;
      } else if (riskScore >= config.thresholds.high) {
        riskTier = 'high-risk';
        riskLevel = RiskLevel.HIGH;
      } else if (riskScore >= config.thresholds.medium) {
        riskTier = 'at-risk';
        riskLevel = RiskLevel.MEDIUM;
      } else {
        riskTier = 'watch';
        riskLevel = RiskLevel.LOW;
      }

      // Generate recommendations
      const recommendations = this.generateArrearsRecommendations(input, riskScore, riskTier);

      // Build prediction
      const now = new Date();
      const expiresAt = this.calculateExpirationDate(now, horizon);
      
      const prediction: ArrearsRiskPrediction = {
        id: predictionId,
        modelType: PredictionModelType.ARREARS_RISK,
        modelVersion: config.version,
        horizon,
        probability: riskScore,
        confidence: scoreToConfidenceLevel(0.75), // Model confidence
        riskLevel,
        tenant,
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        featureImportance: features.sort((a, b) => b.importance - a.importance),
        input,
        prediction: {
          arrearsProbability: riskScore,
          expectedArrearsAmount: riskScore * input.currentContext.rentAmount,
          expectedArrearsDays: Math.round(riskScore * 30),
          riskTier,
        },
        recommendedActions: recommendations,
        alertConfig: {
          shouldAlert: riskLevel !== RiskLevel.LOW,
          alertPriority: riskLevel === RiskLevel.CRITICAL ? 'critical' : 
                        riskLevel === RiskLevel.HIGH ? 'high' : 'medium',
          alertRecipients: this.getAlertRecipients(riskLevel),
          alertMessage: this.generateArrearsAlertMessage(input, riskTier, riskScore),
        },
      };

      // Notify listeners
      this.eventListeners.forEach(l => l.onPredictionGenerated?.(prediction));
      if (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL) {
        this.eventListeners.forEach(l => l.onHighRiskDetected?.(prediction));
      }

      return aiOk(prediction);

    } catch (error) {
      const predictionError: PredictionError = {
        code: 'PREDICTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        modelType: PredictionModelType.ARREARS_RISK,
        retryable: true,
      };
      this.eventListeners.forEach(l => l.onPredictionError?.(predictionError));
      return aiErr(predictionError);
    }
  }

  /**
   * Predict churn risk
   */
  async predictChurnRisk(
    input: ChurnRiskInput,
    tenant: AITenantContext,
    horizon: PredictionHorizon = PredictionHorizon.QUARTER
  ): Promise<AIResult<ChurnRiskPrediction, PredictionError>> {
    const config = this.modelConfigs.get(PredictionModelType.CHURN_RISK)!;
    const predictionId = asPredictionId(uuidv4());

    try {
      const features: FeatureImportance[] = [];
      let riskScore = 0.3; // Base churn probability

      // Days until expiry (closer = higher risk)
      const expiryFactor = input.leaseStatus.daysUntilExpiry <= 90 ? 
        1 - (input.leaseStatus.daysUntilExpiry / 90) : 0;
      riskScore += config.featureWeights.daysUntilExpiry * expiryFactor * -1;
      features.push({
        feature: 'daysUntilExpiry',
        displayName: 'Days Until Lease Expiry',
        value: input.leaseStatus.daysUntilExpiry,
        importance: Math.abs(config.featureWeights.daysUntilExpiry),
        direction: input.leaseStatus.daysUntilExpiry < 60 ? 'positive' : 'neutral',
      });

      // Complaint count
      const complaintNormalized = Math.min(input.tenantEngagement.complaintCount12m / 5, 1);
      riskScore += config.featureWeights.complaintCount12m * complaintNormalized;
      features.push({
        feature: 'complaintCount12m',
        displayName: 'Complaints (12 months)',
        value: input.tenantEngagement.complaintCount12m,
        importance: Math.abs(config.featureWeights.complaintCount12m),
        direction: input.tenantEngagement.complaintCount12m > 2 ? 'positive' : 'negative',
      });

      // Rent vs market
      const rentDiff = (input.marketFactors.currentRent - input.marketFactors.marketRateEstimate) / 
        input.marketFactors.marketRateEstimate;
      const rentFactor = rentDiff > 0 ? rentDiff : 0;
      riskScore += config.featureWeights.rentVsMarket * rentFactor;
      features.push({
        feature: 'rentVsMarket',
        displayName: 'Rent vs Market Rate',
        value: `${(rentDiff * 100).toFixed(1)}%`,
        importance: Math.abs(config.featureWeights.rentVsMarket),
        direction: rentDiff > 0.1 ? 'positive' : rentDiff < -0.1 ? 'negative' : 'neutral',
      });

      // Renewals completed (loyalty indicator)
      const loyaltyFactor = Math.min(input.leaseStatus.renewalsCompleted / 3, 1);
      riskScore += config.featureWeights.renewalsCompleted * (1 - loyaltyFactor);
      features.push({
        feature: 'renewalsCompleted',
        displayName: 'Previous Renewals',
        value: input.leaseStatus.renewalsCompleted,
        importance: Math.abs(config.featureWeights.renewalsCompleted),
        direction: input.leaseStatus.renewalsCompleted >= 2 ? 'negative' : 'positive',
      });

      // Clamp
      riskScore = Math.max(0, Math.min(1, riskScore));

      // Determine tier
      let riskTier: 'stable' | 'watch' | 'at-risk' | 'likely-churning';
      let riskLevel: RiskLevel;
      if (riskScore >= config.thresholds.critical) {
        riskTier = 'likely-churning';
        riskLevel = RiskLevel.CRITICAL;
      } else if (riskScore >= config.thresholds.high) {
        riskTier = 'at-risk';
        riskLevel = RiskLevel.HIGH;
      } else if (riskScore >= config.thresholds.medium) {
        riskTier = 'watch';
        riskLevel = RiskLevel.MEDIUM;
      } else {
        riskTier = 'stable';
        riskLevel = RiskLevel.LOW;
      }

      // Determine primary churn factor
      const sortedFeatures = features.sort((a, b) => b.importance - a.importance);
      const primaryFactor = sortedFeatures.find(f => f.direction === 'positive')?.displayName ?? 
        'General dissatisfaction';

      // Calculate financial impact
      const vacancyMonths = 1.5; // Average time to re-let
      const turnoverCost = input.marketFactors.currentRent * 0.5; // Turnover costs
      const financialImpact = {
        vacancyCost: input.marketFactors.currentRent * vacancyMonths,
        turnoverCost,
        rentLoss: input.marketFactors.currentRent * vacancyMonths,
        totalImpact: input.marketFactors.currentRent * vacancyMonths + turnoverCost,
      };

      // Generate retention recommendations
      const recommendations = this.generateChurnRecommendations(input, riskScore, riskTier, primaryFactor);

      const now = new Date();
      const prediction: ChurnRiskPrediction = {
        id: predictionId,
        modelType: PredictionModelType.CHURN_RISK,
        modelVersion: config.version,
        horizon,
        probability: riskScore,
        confidence: scoreToConfidenceLevel(0.7),
        riskLevel,
        tenant,
        generatedAt: now.toISOString(),
        expiresAt: this.calculateExpirationDate(now, horizon).toISOString(),
        featureImportance: sortedFeatures,
        input,
        prediction: {
          churnProbability: riskScore,
          primaryChurnFactor: primaryFactor,
          likelyToGiveNotice: riskScore >= 0.6,
          estimatedNoticeDays: riskScore >= 0.6 ? Math.round(30 * (1 - riskScore)) : undefined,
          riskTier,
        },
        retentionRecommendations: recommendations,
        financialImpact,
      };

      this.eventListeners.forEach(l => l.onPredictionGenerated?.(prediction));
      if (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL) {
        this.eventListeners.forEach(l => l.onHighRiskDetected?.(prediction));
      }

      return aiOk(prediction);

    } catch (error) {
      const predictionError: PredictionError = {
        code: 'PREDICTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        modelType: PredictionModelType.CHURN_RISK,
        retryable: true,
      };
      return aiErr(predictionError);
    }
  }

  /**
   * Score occupancy health
   */
  async scoreOccupancyHealth(
    input: OccupancyHealthInput,
    tenant: AITenantContext
  ): Promise<AIResult<OccupancyHealthScore, PredictionError>> {
    const config = this.modelConfigs.get(PredictionModelType.OCCUPANCY_HEALTH)!;
    const predictionId = asPredictionId(uuidv4());

    try {
      // Calculate component scores
      const occupancyScore = (input.portfolio.occupiedUnits / input.portfolio.totalUnits) * 100;
      const collectionScore = input.financialMetrics.collectionRate * 100;
      const retentionScore = input.tenantComposition.renewalRate * 100;
      const marketPositionScore = Math.min(
        100,
        Math.max(0, 50 + (input.financialMetrics.marketRateComparison * 50))
      );
      const efficiencyScore = Math.max(0, 100 - (input.tenantComposition.tenantTurnoverRate12m * 200));

      // Calculate overall score (weighted average)
      const overallScore = 
        occupancyScore * config.featureWeights.occupancyRate +
        collectionScore * config.featureWeights.collectionRate +
        retentionScore * config.featureWeights.renewalRate +
        marketPositionScore * config.featureWeights.marketPosition +
        efficiencyScore * Math.abs(config.featureWeights.turnoverRate);

      // Determine grade
      let grade: 'A' | 'B' | 'C' | 'D' | 'F';
      if (overallScore >= 90) grade = 'A';
      else if (overallScore >= 80) grade = 'B';
      else if (overallScore >= 70) grade = 'C';
      else if (overallScore >= 60) grade = 'D';
      else grade = 'F';

      // Determine trend (placeholder - would compare with historical)
      const trend: 'improving' | 'stable' | 'declining' = 'stable';

      // Generate SWOT-like insights
      const insights = this.generateOccupancyInsights(input, {
        occupancy: occupancyScore,
        collection: collectionScore,
        retention: retentionScore,
        marketPosition: marketPositionScore,
        operationalEfficiency: efficiencyScore,
      });

      // Generate improvement recommendations
      const improvements = this.generateOccupancyImprovements(input, {
        occupancy: occupancyScore,
        collection: collectionScore,
        retention: retentionScore,
      });

      const riskLevel = overallScore >= 70 ? RiskLevel.LOW :
                       overallScore >= 50 ? RiskLevel.MEDIUM : RiskLevel.HIGH;

      const now = new Date();
      const prediction: OccupancyHealthScore = {
        id: predictionId,
        modelType: PredictionModelType.OCCUPANCY_HEALTH,
        modelVersion: config.version,
        horizon: PredictionHorizon.MONTH,
        probability: overallScore / 100,
        confidence: scoreToConfidenceLevel(0.85),
        riskLevel,
        tenant,
        generatedAt: now.toISOString(),
        expiresAt: this.calculateExpirationDate(now, PredictionHorizon.MONTH).toISOString(),
        featureImportance: [
          { feature: 'occupancyRate', displayName: 'Occupancy Rate', value: occupancyScore, importance: 0.3, direction: occupancyScore >= 90 ? 'positive' : 'negative' },
          { feature: 'collectionRate', displayName: 'Collection Rate', value: collectionScore, importance: 0.25, direction: collectionScore >= 95 ? 'positive' : 'negative' },
          { feature: 'renewalRate', displayName: 'Renewal Rate', value: retentionScore, importance: 0.2, direction: retentionScore >= 70 ? 'positive' : 'negative' },
        ],
        input,
        healthScore: {
          overall: Math.round(overallScore),
          grade,
          trend,
        },
        componentScores: {
          occupancy: Math.round(occupancyScore),
          collection: Math.round(collectionScore),
          retention: Math.round(retentionScore),
          marketPosition: Math.round(marketPositionScore),
          operationalEfficiency: Math.round(efficiencyScore),
        },
        insights,
        improvements,
        projectedImpact: {
          revenueUplift: this.calculateRevenueUplift(input, improvements),
          occupancyImprovement: improvements.length > 0 ? 3 : 0,
          collectionImprovement: improvements.length > 0 ? 2 : 0,
          timeToImpactDays: 90,
        },
      };

      this.eventListeners.forEach(l => l.onPredictionGenerated?.(prediction));
      return aiOk(prediction);

    } catch (error) {
      return aiErr({
        code: 'PREDICTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        modelType: PredictionModelType.OCCUPANCY_HEALTH,
        retryable: true,
      });
    }
  }

  // Helper methods

  private calculateExpirationDate(from: Date, horizon: PredictionHorizon): Date {
    const days = {
      [PredictionHorizon.WEEK]: 7,
      [PredictionHorizon.MONTH]: 30,
      [PredictionHorizon.QUARTER]: 90,
      [PredictionHorizon.HALF_YEAR]: 180,
      [PredictionHorizon.YEAR]: 365,
    };
    return new Date(from.getTime() + days[horizon] * 24 * 60 * 60 * 1000);
  }

  private getAlertRecipients(riskLevel: RiskLevel): string[] {
    switch (riskLevel) {
      case RiskLevel.CRITICAL:
        return ['property-manager', 'finance-manager', 'senior-management'];
      case RiskLevel.HIGH:
        return ['property-manager', 'collections-agent'];
      case RiskLevel.MEDIUM:
        return ['property-manager'];
      default:
        return [];
    }
  }

  private generateArrearsAlertMessage(input: ArrearsRiskInput, tier: string, score: number): string {
    return `Arrears risk alert for tenant in unit ${input.unitId}: Risk tier ${tier} (score: ${(score * 100).toFixed(0)}%). ` +
      `Current arrears: ${input.paymentHistory.currentArrearsAmount}. Payment on-time rate: ${(input.paymentHistory.onTimeRate * 100).toFixed(0)}%.`;
  }

  private generateArrearsRecommendations(
    input: ArrearsRiskInput,
    score: number,
    tier: string
  ): RecommendedAction[] {
    const actions: RecommendedAction[] = [];

    if (!input.currentContext.hasAutoPay) {
      actions.push({
        id: 'enable-autopay',
        priority: 'high',
        category: 'payment',
        title: 'Enable Auto-Pay',
        description: 'Reach out to tenant to set up automatic rent payments',
        expectedImpact: {
          metric: 'onTimeRate',
          currentValue: input.paymentHistory.onTimeRate,
          projectedValue: Math.min(1, input.paymentHistory.onTimeRate + 0.15),
          changePercent: 15,
        },
        automationAvailable: true,
        automationId: 'autopay-invitation',
      });
    }

    if (score >= 0.5) {
      actions.push({
        id: 'payment-plan',
        priority: score >= 0.7 ? 'immediate' : 'high',
        category: 'collections',
        title: 'Offer Payment Plan',
        description: 'Proactively offer a payment arrangement before arrears escalate',
        expectedImpact: {
          metric: 'arrearsRisk',
          currentValue: score,
          projectedValue: score * 0.7,
          changePercent: -30,
        },
        automationAvailable: true,
        automationId: 'payment-plan-offer',
      });
    }

    if (score >= 0.7) {
      actions.push({
        id: 'personal-outreach',
        priority: 'immediate',
        category: 'relationship',
        title: 'Personal Outreach Call',
        description: 'Schedule a call to understand tenant situation and discuss options',
        expectedImpact: {
          metric: 'retention',
          changePercent: 20,
        },
        automationAvailable: false,
      });
    }

    return actions;
  }

  private generateChurnRecommendations(
    input: ChurnRiskInput,
    score: number,
    tier: string,
    primaryFactor: string
  ): RecommendedAction[] {
    const actions: RecommendedAction[] = [];

    // Early renewal offer for high-risk tenants close to expiry
    if (input.leaseStatus.daysUntilExpiry <= 90 && score >= 0.4) {
      actions.push({
        id: 'early-renewal',
        priority: 'high',
        category: 'retention',
        title: 'Early Renewal Offer',
        description: 'Send personalized early renewal offer with incentive',
        expectedImpact: {
          metric: 'churnProbability',
          currentValue: score,
          projectedValue: score * 0.6,
          changePercent: -40,
        },
        automationAvailable: true,
        automationId: 'early-renewal-offer',
      });
    }

    // Address complaints
    if (input.tenantEngagement.complaintCount12m > 2) {
      actions.push({
        id: 'complaint-resolution',
        priority: 'high',
        category: 'service',
        title: 'Complaint Resolution Follow-Up',
        description: 'Review and address outstanding complaints with personal attention',
        expectedImpact: {
          metric: 'satisfaction',
          changePercent: 25,
        },
        automationAvailable: false,
      });
    }

    // Rent adjustment consideration
    const rentDiff = (input.marketFactors.currentRent - input.marketFactors.marketRateEstimate) / 
      input.marketFactors.marketRateEstimate;
    if (rentDiff > 0.1 && score >= 0.5) {
      actions.push({
        id: 'rent-review',
        priority: 'medium',
        category: 'pricing',
        title: 'Rent Review',
        description: 'Consider rent adjustment or added value to align with market',
        expectedImpact: {
          metric: 'churnProbability',
          currentValue: score,
          projectedValue: score * 0.75,
          changePercent: -25,
        },
        automationAvailable: false,
      });
    }

    return actions;
  }

  private generateOccupancyInsights(
    input: OccupancyHealthInput,
    scores: Record<string, number>
  ): { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const opportunities: string[] = [];
    const threats: string[] = [];

    if (scores.occupancy >= 95) strengths.push('Excellent occupancy rate');
    else if (scores.occupancy < 85) weaknesses.push('Below-target occupancy');

    if (scores.collection >= 98) strengths.push('Strong rent collection');
    else if (scores.collection < 90) weaknesses.push('Collection rate needs improvement');

    if (scores.retention >= 75) strengths.push('High tenant retention');
    else if (scores.retention < 60) weaknesses.push('Tenant turnover is a concern');

    if (input.marketContext.marketTrend === 'growing') {
      opportunities.push('Growing market presents rent increase opportunity');
    } else if (input.marketContext.marketTrend === 'declining') {
      threats.push('Declining market may impact occupancy');
    }

    if (input.marketContext.localVacancyRate > 0.1) {
      threats.push('High local vacancy rate increases competition');
    } else {
      opportunities.push('Low local vacancy supports pricing power');
    }

    return { strengths, weaknesses, opportunities, threats };
  }

  private generateOccupancyImprovements(
    input: OccupancyHealthInput,
    scores: Record<string, number>
  ): RecommendedAction[] {
    const improvements: RecommendedAction[] = [];

    if (scores.occupancy < 90) {
      improvements.push({
        id: 'marketing-boost',
        priority: 'high',
        category: 'marketing',
        title: 'Increase Marketing Efforts',
        description: 'Enhance listing visibility and consider promotional offers for vacant units',
        expectedImpact: {
          metric: 'occupancy',
          currentValue: scores.occupancy,
          projectedValue: Math.min(95, scores.occupancy + 5),
          changePercent: 5,
        },
        automationAvailable: true,
        automationId: 'listing-boost',
      });
    }

    if (scores.collection < 95) {
      improvements.push({
        id: 'collection-campaign',
        priority: 'high',
        category: 'finance',
        title: 'Collection Improvement Initiative',
        description: 'Implement payment reminders and follow-up procedures',
        expectedImpact: {
          metric: 'collection',
          currentValue: scores.collection,
          projectedValue: Math.min(99, scores.collection + 3),
          changePercent: 3,
        },
        automationAvailable: true,
        automationId: 'payment-reminders',
      });
    }

    return improvements;
  }

  private calculateRevenueUplift(input: OccupancyHealthInput, improvements: RecommendedAction[]): number {
    let uplift = 0;
    for (const action of improvements) {
      if (action.expectedImpact.metric === 'occupancy' && action.expectedImpact.changePercent) {
        const avgRent = input.financialMetrics.avgRentPerUnit;
        const additionalUnits = (input.portfolio.totalUnits * action.expectedImpact.changePercent) / 100;
        uplift += avgRent * additionalUnits * 12; // Annual impact
      }
      if (action.expectedImpact.metric === 'collection' && action.expectedImpact.changePercent) {
        const totalRent = input.financialMetrics.grossPotentialRent;
        uplift += totalRent * (action.expectedImpact.changePercent / 100);
      }
    }
    return Math.round(uplift);
  }
}

/**
 * Factory function
 */
export function createPredictionEngine(): PredictionEngine {
  return new PredictionEngine();
}
