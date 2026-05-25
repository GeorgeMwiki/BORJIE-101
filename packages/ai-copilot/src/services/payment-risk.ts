/**
 * Payment Risk Predictor Service
 * AI-powered payment risk assessment
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { PAYMENT_RISK_PROMPT } from '../prompts/index.js';
import {
  type AnthropicClient,
  createAnthropicClient,
  generateStructured,
  ModelTier,
} from '../providers/anthropic-client.js';
import {
  calculatePaymentRisk,
  type DeterministicPaymentRiskResult,
  type PaymentRiskInput as DeterministicPaymentRiskInput,
} from './risk/payment-risk-calculator.js';

export const PaymentRiskLevel = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  ELEVATED: 'ELEVATED',
  MODERATE: 'MODERATE',
  LOW: 'LOW',
} as const;

export type PaymentRiskLevel = (typeof PaymentRiskLevel)[keyof typeof PaymentRiskLevel];

export const PaymentPattern = {
  CONSISTENT_EARLY: 'CONSISTENT_EARLY',
  CONSISTENT_ON_TIME: 'CONSISTENT_ON_TIME',
  OCCASIONAL_LATE: 'OCCASIONAL_LATE',
  FREQUENTLY_LATE: 'FREQUENTLY_LATE',
  DETERIORATING: 'DETERIORATING',
  IMPROVING: 'IMPROVING',
  ERRATIC: 'ERRATIC',
  NEW_TENANT: 'NEW_TENANT',
} as const;

export type PaymentPattern = (typeof PaymentPattern)[keyof typeof PaymentPattern];

export interface PaymentCustomerData {
  customerId: string;
  currentBalance: number;
  monthlyRent: number;
  paymentsDue: number;
  paymentHistory: {
    last12Months: Array<{
      month: string;
      dueDate: string;
      paidDate?: string;
      amount: number;
      daysLate?: number;
      partialPayment?: boolean;
    }>;
    totalOnTime: number;
    totalLate: number;
    totalMissed: number;
    averageDaysLate: number;
  };
  financialIndicators?: {
    incomeToRentRatio?: number;
    employmentStatus?: 'employed' | 'self-employed' | 'unemployed' | 'retired' | 'unknown';
    recentJobChange?: boolean;
  };
  communicationSignals?: {
    paymentPlanRequests: number;
    hardshipMentions: number;
    unresponsivePeriods: number;
  };
}

export interface PaymentRiskFactor {
  factor: string;
  weight: number;
  category: 'behavioral' | 'financial' | 'communication' | 'external';
  trend: 'improving' | 'stable' | 'worsening';
  details: string;
}

export interface PaymentIntervention {
  action: string;
  type: 'preventive' | 'corrective' | 'escalation';
  timing: 'immediate' | 'before_due_date' | 'after_due_date' | 'ongoing';
  priority: 'critical' | 'high' | 'medium' | 'low';
  expectedOutcome: string;
  automatable: boolean;
}

export interface PaymentRiskResult {
  score: number;
  riskLevel: PaymentRiskLevel;
  confidence: number;
  pattern: PaymentPattern;
  factors: PaymentRiskFactor[];
  riskTrend: 'improving' | 'stable' | 'worsening';
  nextPaymentPrediction: {
    likelihood: 'on_time' | 'late' | 'at_risk' | 'likely_missed';
    expectedDaysLate?: number;
    confidence: number;
  };
  interventions: PaymentIntervention[];
  financialExposure: {
    currentExposure: number;
    projectedExposure30Days: number;
    projectedExposure90Days: number;
  };
  earlyWarningSignals: string[];
  reasoning: string;
}

const PaymentRiskResultSchema = z.object({
  score: z.number().min(0).max(100),
  riskLevel: z.enum(['CRITICAL', 'HIGH', 'ELEVATED', 'MODERATE', 'LOW']),
  confidence: z.number().min(0).max(1),
  pattern: z.enum(['CONSISTENT_EARLY', 'CONSISTENT_ON_TIME', 'OCCASIONAL_LATE',
    'FREQUENTLY_LATE', 'DETERIORATING', 'IMPROVING', 'ERRATIC', 'NEW_TENANT']),
  factors: z.array(z.object({
    factor: z.string(),
    weight: z.number().min(0).max(1),
    category: z.enum(['behavioral', 'financial', 'communication', 'external']),
    trend: z.enum(['improving', 'stable', 'worsening']),
    details: z.string(),
  })),
  riskTrend: z.enum(['improving', 'stable', 'worsening']),
  nextPaymentPrediction: z.object({
    likelihood: z.enum(['on_time', 'late', 'at_risk', 'likely_missed']),
    expectedDaysLate: z.number().optional(),
    confidence: z.number().min(0).max(1),
  }),
  interventions: z.array(z.object({
    action: z.string(),
    type: z.enum(['preventive', 'corrective', 'escalation']),
    timing: z.enum(['immediate', 'before_due_date', 'after_due_date', 'ongoing']),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    expectedOutcome: z.string(),
    automatable: z.boolean(),
  })),
  financialExposure: z.object({
    currentExposure: z.number(),
    projectedExposure30Days: z.number(),
    projectedExposure90Days: z.number(),
  }),
  earlyWarningSignals: z.array(z.string()),
  reasoning: z.string(),
});

export interface PaymentRiskConfig {
  /** @deprecated Kept for backwards compatibility during migration. */
  openaiApiKey?: string;
  /** Preferred: Anthropic API key (ANTHROPIC_API_KEY). */
  anthropicApiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  anthropicClient?: AnthropicClient;
}

export class PaymentRiskService {
  private anthropic: AnthropicClient;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: PaymentRiskConfig) {
    this.model = config.model ?? ModelTier.SONNET;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;

    if (config.anthropicClient) {
      this.anthropic = config.anthropicClient;
    } else {
      const apiKey =
        config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
      if (!apiKey) {
        throw new Error(
          'PaymentRiskService: ANTHROPIC_API_KEY or anthropicClient is required',
        );
      }
      this.anthropic = createAnthropicClient({
        apiKey,
        defaultModel: this.model,
      });
    }
  }

  async predictPaymentRisk(
    customerId: string,
    data?: Partial<PaymentCustomerData>,
    deterministicInput?: DeterministicPaymentRiskInput,
  ): Promise<PaymentRiskResult> {
    const customerData = this.buildCustomerData(customerId, data);

    // DETERMINISTIC FLOOR — compute first, never mutate from LLM output
    const deterministic = deterministicInput
      ? calculatePaymentRisk(deterministicInput)
      : this.deriveDeterministicFromCustomerData(customerData);

    const userContent = `${PAYMENT_RISK_PROMPT.user}

Customer Data:
${JSON.stringify(customerData, null, 2)}

DETERMINISTIC SCORE (authoritative — narrate, do not override):
${JSON.stringify(deterministic, null, 2)}`;

    const result = await generateStructured(this.anthropic, {
      systemPrompt: PAYMENT_RISK_PROMPT.system,
      prompt: userContent,
      schema: PaymentRiskResultSchema,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });

    // Enforce: LLM may narrate but NOT overwrite the score/level we computed.
    const narrated = result.data as PaymentRiskResult;
    return {
      ...narrated,
      score: deterministic.score,
      riskLevel:
        deterministic.level as unknown as PaymentRiskResult['riskLevel'],
    };
  }

  /**
   * Map the incoming `PaymentCustomerData` to the deterministic calculator's
   * input shape. Missing fields fall back to neutral values so we always have
   * a score floor.
   */
  private deriveDeterministicFromCustomerData(
    data: PaymentCustomerData,
  ): DeterministicPaymentRiskResult {
    const statusRaw = data.financialIndicators?.employmentStatus ?? 'unknown';
    const employmentStatus: DeterministicPaymentRiskInput['employment']['status'] =
      statusRaw === 'employed' ||
      statusRaw === 'self-employed' ||
      statusRaw === 'unemployed' ||
      statusRaw === 'retired'
        ? statusRaw
        : 'unknown';

    const input: DeterministicPaymentRiskInput = {
      history: {
        totalOnTime: data.paymentHistory.totalOnTime,
        totalLate: data.paymentHistory.totalLate,
        totalMissed: data.paymentHistory.totalMissed,
        averageDaysLate: data.paymentHistory.averageDaysLate,
      },
      income: {
        monthlyNetIncome:
          data.financialIndicators?.incomeToRentRatio != null && data.monthlyRent
            ? data.financialIndicators.incomeToRentRatio * data.monthlyRent
            : 0,
        monthlyRent: data.monthlyRent,
      },
      employment: {
        status: employmentStatus,
        monthsAtEmployer: data.financialIndicators?.recentJobChange ? 3 : 24,
        verified: !data.financialIndicators?.recentJobChange,
      },
      arrears: {
        currentBalance: data.currentBalance,
        monthlyRent: data.monthlyRent,
      },
      litigation: {
        evictions: 0,
        judgments: 0,
        activeLawsuits: 0,
      },
    };
    return calculatePaymentRisk(input);
  }

  private buildCustomerData(customerId: string, data?: Partial<PaymentCustomerData>): PaymentCustomerData {
    return {
      customerId,
      currentBalance: data?.currentBalance ?? 0,
      monthlyRent: data?.monthlyRent ?? 0,
      paymentsDue: data?.paymentsDue ?? 0,
      paymentHistory: data?.paymentHistory ?? {
        last12Months: [],
        totalOnTime: 0,
        totalLate: 0,
        totalMissed: 0,
        averageDaysLate: 0,
      },
      financialIndicators: data?.financialIndicators,
      communicationSignals: data?.communicationSignals,
    };
  }
}

export function createPaymentRiskService(config: PaymentRiskConfig): PaymentRiskService {
  return new PaymentRiskService(config);
}

export async function predictPaymentRisk(
  customerId: string,
  data?: Partial<PaymentCustomerData>,
  config?: Partial<PaymentRiskConfig>,
): Promise<PaymentRiskResult> {
  const anthropicApiKey =
    config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey && !config?.anthropicClient) {
    throw new Error('Anthropic API key or client is required');
  }
  const service = createPaymentRiskService({
    anthropicApiKey,
    ...config,
  });
  return service.predictPaymentRisk(customerId, data);
}
