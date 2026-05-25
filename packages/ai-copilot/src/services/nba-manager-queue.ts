/**
 * NBA Manager Queue (Enhanced Next Best Action - Workflow C.3)
 * 
 * Extends the Next Best Action engine with:
 * - Daily/weekly manager action queues
 * - Auto-execution within policy thresholds
 * - Multi-signal input processing
 * - Action prioritization and batching
 * 
 * @module nba-manager-queue
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { NBA_MANAGER_QUEUE_PROMPT } from '../prompts/copilot-prompts.js';

// ============================================================================
// Types and Enums
// ============================================================================

export const ActionType = {
  // Communication Actions
  SEND_REMINDER: 'send_reminder',
  SEND_UPDATE: 'send_update',
  SCHEDULE_CALL: 'schedule_call',
  SEND_ANNOUNCEMENT: 'send_announcement',
  
  // Payment Actions
  OFFER_PAYMENT_PLAN: 'offer_payment_plan',
  APPLY_LATE_FEE: 'apply_late_fee',
  WAIVE_FEE: 'waive_fee',
  SEND_PAYMENT_REMINDER: 'send_payment_reminder',
  
  // Retention Actions
  ISSUE_PERK: 'issue_perk',
  OFFER_DISCOUNT: 'offer_discount',
  PROPOSE_RENEWAL: 'propose_renewal',
  RETENTION_OUTREACH: 'retention_outreach',
  
  // Service Actions
  PRIORITIZE_MAINTENANCE: 'prioritize_maintenance',
  SCHEDULE_INSPECTION: 'schedule_inspection',
  ASSIGN_VENDOR: 'assign_vendor',
  
  // Relationship Actions
  SATISFACTION_CHECKIN: 'satisfaction_checkin',
  ESCALATE_TO_MANAGER: 'escalate_to_manager',
  SEND_EDUCATION: 'send_education',
  COMMUNITY_INTRODUCTION: 'community_introduction',
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const ExecutionMode = {
  AUTO: 'auto',           // Execute automatically within policy
  APPROVAL: 'approval',   // Requires manager approval
  MANUAL: 'manual',       // Manager must execute manually
  SCHEDULED: 'scheduled', // Execute at scheduled time
} as const;

export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];

export const QueuePriority = {
  CRITICAL: 'critical',   // Immediate attention required
  HIGH: 'high',           // Today
  MEDIUM: 'medium',       // This week
  LOW: 'low',             // When convenient
} as const;

export type QueuePriority = (typeof QueuePriority)[keyof typeof QueuePriority];

// ============================================================================
// Input Interfaces
// ============================================================================

export interface TenantSignals {
  tenantId: string;
  unitId: string;
  propertyId: string;
  
  // Risk Signals
  paymentRiskScore?: number;     // 0-100
  churnRiskScore?: number;       // 0-100
  disputeRiskScore?: number;     // 0-100
  
  // Engagement Signals
  sentimentScore?: number;       // -1 to 1
  sentimentTrend?: 'improving' | 'stable' | 'declining';
  engagementLevel?: 'high' | 'medium' | 'low' | 'disengaged';
  lastContactDate?: string;
  daysSinceLastContact?: number;
  
  // Maintenance Signals
  openMaintenanceCount?: number;
  maintenanceSatisfaction?: number; // 1-5
  avgMaintenanceTime?: number;    // days
  
  // Payment Signals
  daysOverdue?: number;
  outstandingBalance?: number;
  paymentHistory?: {
    onTimePayments: number;
    latePayments: number;
    missedPayments: number;
  };
  
  // Lease Signals
  leaseEndDate?: string;
  daysToLeaseEnd?: number;
  renewalHistory?: number;
  
  // Behavioral Signals
  complaintCount30Days?: number;
  escalationCount30Days?: number;
  positiveInteractions30Days?: number;
}

export interface PolicyThresholds {
  // Auto-execution thresholds
  autoApproveDiscountPercent: number;      // Max discount that can auto-approve
  autoApproveFeewaiverAmount: number;      // Max fee waiver amount
  autoApprovePerkValue: number;            // Max perk value
  
  // Escalation thresholds
  paymentRiskEscalationThreshold: number;  // Score above this escalates
  churnRiskEscalationThreshold: number;
  disputeRiskEscalationThreshold: number;
  
  // Timing thresholds
  daysOverdueBeforeEscalation: number;
  daysToLeaseEndForRenewal: number;
  daysSinceContactForCheckin: number;
}

export interface QueueConfiguration {
  managerId: string;
  propertyIds: string[];
  queueType: 'daily' | 'weekly';
  includePriorities: QueuePriority[];
  maxItemsPerQueue: number;
  autoExecutionEnabled: boolean;
  policyThresholds: PolicyThresholds;
}

// ============================================================================
// Output Interfaces
// ============================================================================

export interface QueuedAction {
  id: string;
  tenantId: string;
  unitId: string;
  propertyId: string;
  
  // Action Details
  actionType: ActionType;
  title: string;
  description: string;
  
  // Prioritization
  priority: QueuePriority;
  urgencyScore: number; // 0-100
  impactScore: number;  // 0-100
  confidenceScore: number; // 0-1
  
  // Execution
  executionMode: ExecutionMode;
  canAutoExecute: boolean;
  autoExecuteReason?: string;
  requiresApprovalReason?: string;
  
  // Timing
  suggestedExecutionTime: string;
  deadline?: string;
  
  // Content
  suggestedContent?: {
    messageTemplate?: string;
    offerDetails?: Record<string, unknown>;
    scriptPoints?: string[];
  };
  
  // Expected Outcomes
  expectedOutcome: {
    primaryBenefit: string;
    successProbability: number;
    revenueImpact?: number;
    retentionImpact?: number;
    satisfactionImpact?: number;
  };
  
  // Risk Assessment
  riskIfNotDone: string;
  riskIfDone?: string;
  
  // Evidence
  triggerSignals: string[];
  dataUsed: string[];
  
  // Tracking
  createdAt: string;
  status: 'pending' | 'approved' | 'executed' | 'rejected' | 'deferred';
}

export interface ManagerQueueResult {
  queueId: string;
  managerId: string;
  generatedAt: string;
  queueType: 'daily' | 'weekly';
  periodStart: string;
  periodEnd: string;
  
  // Summary
  summary: {
    totalActions: number;
    byPriority: Record<QueuePriority, number>;
    byActionType: Record<string, number>;
    autoExecutable: number;
    requiresApproval: number;
    estimatedRevenueImpact: number;
    estimatedRetentionImpact: number;
  };
  
  // Actions
  actions: QueuedAction[];
  
  // Insights
  insights: {
    topRisks: Array<{ tenantId: string; risk: string; severity: string }>;
    opportunities: Array<{ description: string; impact: string }>;
    trends: string[];
    recommendations: string[];
  };
  
  // Auto-execution Report
  autoExecutionReport?: {
    executed: Array<{ actionId: string; result: 'success' | 'failed'; timestamp: string }>;
    skipped: Array<{ actionId: string; reason: string }>;
  };
}

// ============================================================================
// Zod Schemas
// ============================================================================

const QueuedActionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  unitId: z.string(),
  propertyId: z.string(),
  actionType: z.enum([
    'send_reminder', 'send_update', 'schedule_call', 'send_announcement',
    'offer_payment_plan', 'apply_late_fee', 'waive_fee', 'send_payment_reminder',
    'issue_perk', 'offer_discount', 'propose_renewal', 'retention_outreach',
    'prioritize_maintenance', 'schedule_inspection', 'assign_vendor',
    'satisfaction_checkin', 'escalate_to_manager', 'send_education', 'community_introduction',
  ]),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  urgencyScore: z.number().min(0).max(100),
  impactScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(1),
  executionMode: z.enum(['auto', 'approval', 'manual', 'scheduled']),
  canAutoExecute: z.boolean(),
  autoExecuteReason: z.string().optional(),
  requiresApprovalReason: z.string().optional(),
  suggestedExecutionTime: z.string(),
  deadline: z.string().optional(),
  suggestedContent: z.object({
    messageTemplate: z.string().optional(),
    offerDetails: z.record(z.string(), z.unknown()).optional(),
    scriptPoints: z.array(z.string()).optional(),
  }).optional(),
  expectedOutcome: z.object({
    primaryBenefit: z.string(),
    successProbability: z.number().min(0).max(1),
    revenueImpact: z.number().optional(),
    retentionImpact: z.number().optional(),
    satisfactionImpact: z.number().optional(),
  }),
  riskIfNotDone: z.string(),
  riskIfDone: z.string().optional(),
  triggerSignals: z.array(z.string()),
  dataUsed: z.array(z.string()),
  createdAt: z.string(),
  status: z.enum(['pending', 'approved', 'executed', 'rejected', 'deferred']),
});

const ManagerQueueResultSchema = z.object({
  queueId: z.string(),
  managerId: z.string(),
  generatedAt: z.string(),
  queueType: z.enum(['daily', 'weekly']),
  periodStart: z.string(),
  periodEnd: z.string(),
  summary: z.object({
    totalActions: z.number(),
    byPriority: z.record(z.string(), z.number()),
    byActionType: z.record(z.string(), z.number()),
    autoExecutable: z.number(),
    requiresApproval: z.number(),
    estimatedRevenueImpact: z.number(),
    estimatedRetentionImpact: z.number(),
  }),
  actions: z.array(QueuedActionSchema),
  insights: z.object({
    topRisks: z.array(z.object({
      tenantId: z.string(),
      risk: z.string(),
      severity: z.string(),
    })),
    opportunities: z.array(z.object({
      description: z.string(),
      impact: z.string(),
    })),
    trends: z.array(z.string()),
    recommendations: z.array(z.string()),
  }),
  autoExecutionReport: z.object({
    executed: z.array(z.object({
      actionId: z.string(),
      result: z.enum(['success', 'failed']),
      timestamp: z.string(),
    })),
    skipped: z.array(z.object({
      actionId: z.string(),
      reason: z.string(),
    })),
  }).optional(),
});

// ============================================================================
// Service Configuration
// ============================================================================

export interface NBAManagerQueueConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class NBAManagerQueueService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: NBAManagerQueueConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 4000;
  }

  /**
   * Generate a manager action queue from tenant signals
   */
  async generateQueue(
    tenantSignals: TenantSignals[],
    config: QueueConfiguration
  ): Promise<ManagerQueueResult> {
    const now = new Date();
    const periodEnd = new Date(now);
    if (config.queueType === 'weekly') {
      periodEnd.setDate(periodEnd.getDate() + 7);
    } else {
      periodEnd.setDate(periodEnd.getDate() + 1);
    }

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: NBA_MANAGER_QUEUE_PROMPT.system },
        {
          role: 'user',
          content: `${NBA_MANAGER_QUEUE_PROMPT.user}

Queue Configuration:
${JSON.stringify(config, null, 2)}

Tenant Signals (${tenantSignals.length} tenants):
${JSON.stringify(tenantSignals, null, 2)}

Generate a ${config.queueType} action queue with up to ${config.maxItemsPerQueue} items.
Queue ID: queue_${Date.now()}
Period: ${now.toISOString()} to ${periodEnd.toISOString()}`,
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return ManagerQueueResultSchema.parse(JSON.parse(content)) as ManagerQueueResult;
  }

  /**
   * Get actions that can be auto-executed
   */
  getAutoExecutableActions(queue: ManagerQueueResult): QueuedAction[] {
    return queue.actions.filter(action => 
      action.canAutoExecute && action.executionMode === 'auto'
    );
  }

  /**
   * Get actions requiring approval
   */
  getActionsRequiringApproval(queue: ManagerQueueResult): QueuedAction[] {
    return queue.actions.filter(action => 
      action.executionMode === 'approval'
    );
  }

  /**
   * Prioritize actions for a specific tenant
   */
  async prioritizeForTenant(
    tenantId: string,
    signals: TenantSignals,
    policyThresholds: PolicyThresholds
  ): Promise<QueuedAction[]> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a tenant success AI that determines the best actions to take for a specific tenant.
Analyze their signals and return a prioritized list of recommended actions.`,
        },
        {
          role: 'user',
          content: `Determine the best actions for this tenant based on their signals.

Tenant Signals:
${JSON.stringify(signals, null, 2)}

Policy Thresholds:
${JSON.stringify(policyThresholds, null, 2)}

Return a JSON array of actions in priority order.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    const result = JSON.parse(content) as { actions: QueuedAction[] };
    return result.actions;
  }

  /**
   * Approve an action in the queue
   */
  approveAction(queue: ManagerQueueResult, actionId: string): ManagerQueueResult {
    return {
      ...queue,
      actions: queue.actions.map(action =>
        action.id === actionId
          ? { ...action, status: 'approved' as const }
          : action
      ),
    };
  }

  /**
   * Reject an action in the queue
   */
  rejectAction(queue: ManagerQueueResult, actionId: string): ManagerQueueResult {
    return {
      ...queue,
      actions: queue.actions.map(action =>
        action.id === actionId
          ? { ...action, status: 'rejected' as const }
          : action
      ),
    };
  }

  /**
   * Mark an action as executed
   */
  markExecuted(queue: ManagerQueueResult, actionId: string, success: boolean): ManagerQueueResult {
    const autoReport = queue.autoExecutionReport ?? { executed: [], skipped: [] };
    
    return {
      ...queue,
      actions: queue.actions.map(action =>
        action.id === actionId
          ? { ...action, status: 'executed' as const }
          : action
      ),
      autoExecutionReport: {
        ...autoReport,
        executed: [
          ...autoReport.executed,
          {
            actionId,
            result: success ? 'success' : 'failed',
            timestamp: new Date().toISOString(),
          },
        ],
      },
    };
  }

  /**
   * Get queue summary statistics
   */
  getQueueStats(queue: ManagerQueueResult): {
    totalActions: number;
    pending: number;
    approved: number;
    executed: number;
    rejected: number;
    avgUrgency: number;
    avgImpact: number;
  } {
    const actions = queue.actions;
    return {
      totalActions: actions.length,
      pending: actions.filter(a => a.status === 'pending').length,
      approved: actions.filter(a => a.status === 'approved').length,
      executed: actions.filter(a => a.status === 'executed').length,
      rejected: actions.filter(a => a.status === 'rejected').length,
      avgUrgency: actions.reduce((sum, a) => sum + a.urgencyScore, 0) / actions.length || 0,
      avgImpact: actions.reduce((sum, a) => sum + a.impactScore, 0) / actions.length || 0,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createNBAManagerQueueService(
  config: NBAManagerQueueConfig
): NBAManagerQueueService {
  return new NBAManagerQueueService(config);
}

export async function generateManagerQueue(
  tenantSignals: TenantSignals[],
  queueConfig: QueueConfiguration,
  config?: Partial<NBAManagerQueueConfig>
): Promise<ManagerQueueResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  
  const service = createNBAManagerQueueService({ openaiApiKey: apiKey, ...config });
  return service.generateQueue(tenantSignals, queueConfig);
}

// ============================================================================
// Default Policy Thresholds
// ============================================================================

export const DEFAULT_POLICY_THRESHOLDS: PolicyThresholds = {
  autoApproveDiscountPercent: 5,
  autoApproveFeewaiverAmount: 50,
  autoApprovePerkValue: 100,
  paymentRiskEscalationThreshold: 75,
  churnRiskEscalationThreshold: 70,
  disputeRiskEscalationThreshold: 60,
  daysOverdueBeforeEscalation: 14,
  daysToLeaseEndForRenewal: 90,
  daysSinceContactForCheckin: 30,
};
