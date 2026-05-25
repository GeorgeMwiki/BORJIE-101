/**
 * Custom Workflows Engine
 * 
 * Implements a flexible workflow engine for enterprise customization:
 * - Visual workflow builder support
 * - Trigger-based workflow activation
 * - Action execution with error handling
 * - Conditional branching and parallel execution
 * - Tenant-specific workflow isolation
 */

import { z } from 'zod';

/**
 * Workflow Status
 */
export const WorkflowStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type WorkflowStatus = typeof WorkflowStatus[keyof typeof WorkflowStatus];

/**
 * Workflow Execution Status
 */
export const ExecutionStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  WAITING: 'WAITING',
} as const;

export type ExecutionStatus = typeof ExecutionStatus[keyof typeof ExecutionStatus];

/**
 * Trigger Types
 */
export const TriggerType = {
  EVENT: 'EVENT',           // Domain event trigger
  SCHEDULE: 'SCHEDULE',     // Cron-based trigger
  MANUAL: 'MANUAL',         // User-initiated
  WEBHOOK: 'WEBHOOK',       // External webhook
  CONDITION: 'CONDITION',   // Data condition met
} as const;

export type TriggerType = typeof TriggerType[keyof typeof TriggerType];

/**
 * Action Types
 */
export const ActionType = {
  HTTP_REQUEST: 'HTTP_REQUEST',     // Call external API
  SEND_EMAIL: 'SEND_EMAIL',         // Send email notification
  SEND_SMS: 'SEND_SMS',             // Send SMS
  CREATE_TASK: 'CREATE_TASK',       // Create a task/work order
  UPDATE_RECORD: 'UPDATE_RECORD',   // Update database record
  SEND_NOTIFICATION: 'SEND_NOTIFICATION', // In-app notification
  WAIT: 'WAIT',                     // Wait for duration
  WAIT_FOR_EVENT: 'WAIT_FOR_EVENT', // Wait for event
  CONDITIONAL: 'CONDITIONAL',       // Branching logic
  PARALLEL: 'PARALLEL',             // Parallel execution
  CALL_WORKFLOW: 'CALL_WORKFLOW',   // Call another workflow
  CUSTOM_SCRIPT: 'CUSTOM_SCRIPT',   // Execute custom logic
} as const;

export type ActionType = typeof ActionType[keyof typeof ActionType];

/**
 * Workflow Trigger Definition
 */
export interface WorkflowTrigger {
  readonly id: string;
  readonly type: TriggerType;
  readonly config: {
    // Event trigger
    readonly eventType?: string;
    readonly eventFilter?: Record<string, unknown>;
    // Schedule trigger
    readonly cronExpression?: string;
    readonly timezone?: string;
    // Webhook trigger
    readonly webhookPath?: string;
    // Condition trigger
    readonly conditionQuery?: string;
    readonly checkInterval?: number;
  };
}

/**
 * Workflow Action Definition
 */
export interface WorkflowAction {
  readonly id: string;
  readonly name: string;
  readonly type: ActionType;
  readonly config: Record<string, unknown>;
  readonly timeout?: number;
  readonly retries?: number;
  readonly onError?: 'fail' | 'continue' | 'retry';
  readonly nextActions?: readonly string[];
  readonly conditionalBranches?: readonly {
    readonly condition: string;
    readonly nextAction: string;
  }[];
}

/**
 * Workflow Definition
 */
export interface WorkflowDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly status: WorkflowStatus;
  readonly trigger: WorkflowTrigger;
  readonly actions: readonly WorkflowAction[];
  readonly startActionId: string;
  readonly variables?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Workflow Execution Record
 */
export interface WorkflowExecution {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly tenantId: string;
  readonly status: ExecutionStatus;
  readonly triggerData: Record<string, unknown>;
  readonly variables: Record<string, unknown>;
  readonly currentActionId?: string;
  readonly actionResults: readonly ActionResult[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: string;
}

/**
 * Action Result
 */
export interface ActionResult {
  readonly actionId: string;
  readonly actionType: ActionType;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly output?: Record<string, unknown>;
  readonly error?: string;
  readonly retryCount: number;
}

/**
 * Workflow Template (pre-built workflows)
 */
export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly trigger: WorkflowTrigger;
  readonly actions: readonly WorkflowAction[];
  readonly startActionId: string;
  readonly variables?: Record<string, unknown>;
  readonly requiredInputs?: readonly {
    readonly name: string;
    readonly type: 'string' | 'number' | 'boolean' | 'date' | 'email';
    readonly description: string;
    readonly required: boolean;
  }[];
}

/**
 * Pre-built workflow templates
 */
export const WorkflowTemplates: WorkflowTemplate[] = [
  {
    id: 'lease-renewal-reminder',
    name: 'Lease Renewal Reminder',
    description: 'Send automated reminders before lease expiration',
    category: 'leases',
    trigger: {
      id: 'trigger-1',
      type: TriggerType.SCHEDULE,
      config: {
        cronExpression: '0 9 * * *', // Daily at 9 AM
        timezone: 'UTC',
      },
    },
    actions: [
      {
        id: 'find-expiring',
        name: 'Find Expiring Leases',
        type: ActionType.CUSTOM_SCRIPT,
        config: {
          script: 'findLeasesExpiringIn',
          params: { daysAhead: '{{variables.reminderDays}}' },
        },
        nextActions: ['send-reminder'],
      },
      {
        id: 'send-reminder',
        name: 'Send Renewal Reminder',
        type: ActionType.SEND_EMAIL,
        config: {
          template: 'lease-renewal-reminder',
          to: '{{lease.tenantEmail}}',
          subject: 'Your lease is expiring soon',
        },
      },
    ],
    startActionId: 'find-expiring',
    variables: {
      reminderDays: 90,
    },
    requiredInputs: [
      {
        name: 'reminderDays',
        type: 'number',
        description: 'Days before expiration to send reminder',
        required: true,
      },
    ],
  },
  {
    id: 'payment-overdue-escalation',
    name: 'Payment Overdue Escalation',
    description: 'Escalate overdue payments with progressive actions',
    category: 'payments',
    trigger: {
      id: 'trigger-1',
      type: TriggerType.EVENT,
      config: {
        eventType: 'payment.overdue',
      },
    },
    actions: [
      {
        id: 'check-days',
        name: 'Check Days Overdue',
        type: ActionType.CONDITIONAL,
        config: {},
        conditionalBranches: [
          { condition: '{{event.daysOverdue}} < 7', nextAction: 'send-reminder' },
          { condition: '{{event.daysOverdue}} >= 7 && {{event.daysOverdue}} < 30', nextAction: 'send-warning' },
          { condition: '{{event.daysOverdue}} >= 30', nextAction: 'create-task' },
        ],
      },
      {
        id: 'send-reminder',
        name: 'Send Friendly Reminder',
        type: ActionType.SEND_EMAIL,
        config: {
          template: 'payment-reminder-friendly',
          to: '{{event.tenantEmail}}',
        },
      },
      {
        id: 'send-warning',
        name: 'Send Payment Warning',
        type: ActionType.SEND_EMAIL,
        config: {
          template: 'payment-warning',
          to: '{{event.tenantEmail}}',
        },
      },
      {
        id: 'create-task',
        name: 'Create Collections Task',
        type: ActionType.CREATE_TASK,
        config: {
          taskType: 'collections',
          assignTo: '{{variables.collectionsTeam}}',
          priority: 'high',
        },
      },
    ],
    startActionId: 'check-days',
    variables: {
      collectionsTeam: 'collections@company.com',
    },
  },
  {
    id: 'maintenance-request-assignment',
    name: 'Maintenance Request Auto-Assignment',
    description: 'Automatically assign maintenance requests based on type and urgency',
    category: 'maintenance',
    trigger: {
      id: 'trigger-1',
      type: TriggerType.EVENT,
      config: {
        eventType: 'maintenance.request_created',
      },
    },
    actions: [
      {
        id: 'categorize',
        name: 'Categorize Request',
        type: ActionType.CONDITIONAL,
        config: {},
        conditionalBranches: [
          { condition: '{{event.category}} == "plumbing"', nextAction: 'assign-plumber' },
          { condition: '{{event.category}} == "electrical"', nextAction: 'assign-electrician' },
          { condition: '{{event.urgency}} == "emergency"', nextAction: 'notify-manager' },
        ],
        nextActions: ['assign-general'],
      },
      {
        id: 'assign-plumber',
        name: 'Assign to Plumber',
        type: ActionType.UPDATE_RECORD,
        config: {
          recordType: 'work_order',
          updates: { assignedTo: '{{variables.plumbingTeam}}' },
        },
        nextActions: ['notify-tenant'],
      },
      {
        id: 'assign-electrician',
        name: 'Assign to Electrician',
        type: ActionType.UPDATE_RECORD,
        config: {
          recordType: 'work_order',
          updates: { assignedTo: '{{variables.electricalTeam}}' },
        },
        nextActions: ['notify-tenant'],
      },
      {
        id: 'assign-general',
        name: 'Assign to General Maintenance',
        type: ActionType.UPDATE_RECORD,
        config: {
          recordType: 'work_order',
          updates: { assignedTo: '{{variables.generalTeam}}' },
        },
        nextActions: ['notify-tenant'],
      },
      {
        id: 'notify-manager',
        name: 'Notify Property Manager',
        type: ActionType.SEND_NOTIFICATION,
        config: {
          to: '{{event.propertyManagerId}}',
          message: 'Emergency maintenance request requires attention',
          priority: 'urgent',
        },
        nextActions: ['assign-general'],
      },
      {
        id: 'notify-tenant',
        name: 'Notify Tenant',
        type: ActionType.SEND_NOTIFICATION,
        config: {
          to: '{{event.tenantId}}',
          message: 'Your maintenance request has been assigned',
        },
      },
    ],
    startActionId: 'categorize',
    variables: {
      plumbingTeam: 'team-plumbing',
      electricalTeam: 'team-electrical',
      generalTeam: 'team-general',
    },
  },
];

/**
 * Workflow Engine
 */
export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private actionHandlers: Map<ActionType, (action: WorkflowAction, context: ExecutionContext) => Promise<Record<string, unknown>>> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  /**
   * Register default action handlers
   */
  private registerDefaultHandlers(): void {
    // HTTP Request handler
    this.actionHandlers.set(ActionType.HTTP_REQUEST, async (action, context) => {
      const config = action.config as {
        url: string;
        method: string;
        headers?: Record<string, string>;
        body?: unknown;
        timeoutMs?: number;
      };

      // Default 30s timeout — workflows must never hang on a slow upstream.
      const timeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0
        ? config.timeoutMs
        : 30_000;

      try {
        const response = await fetch(String(this.interpolate(config.url, context)), {
          method: config.method,
          headers: config.headers,
          body: config.body ? JSON.stringify(this.interpolate(config.body, context)) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });

        return {
          statusCode: response.status,
          body: await response.json().catch((): null => null),
        };
      } catch (error) {
        return {
          statusCode: 0,
          body: null,
          error: error instanceof Error ? error.message : 'request failed',
        };
      }
    });

    // Wait handler
    this.actionHandlers.set(ActionType.WAIT, async (action) => {
      const { duration } = action.config as { duration: number };
      // Guard against NaN, negative, or absurd durations that would stall the engine.
      const safeDuration = Number.isFinite(duration) && duration > 0
        ? Math.min(Math.floor(duration), 24 * 60 * 60 * 1000)
        : 0;
      if (safeDuration > 0) {
        await new Promise((resolve) => setTimeout(resolve, safeDuration));
      }
      return { waited: safeDuration };
    });

    // Conditional handler (returns which branch to take)
    this.actionHandlers.set(ActionType.CONDITIONAL, async (action, context) => {
      for (const branch of action.conditionalBranches ?? []) {
        if (this.evaluateCondition(branch.condition, context)) {
          return { branch: branch.nextAction };
        }
      }
      return { branch: action.nextActions?.[0] ?? null };
    });

    // Custom script handler (placeholder - would integrate with actual script engine)
    this.actionHandlers.set(ActionType.CUSTOM_SCRIPT, async (action, context) => {
      const { script, params } = action.config as { script: string; params: Record<string, unknown> };
      // In real implementation, this would execute the script
      return { script, params: this.interpolate(params, context) };
    });
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(
    type: ActionType,
    handler: (action: WorkflowAction, context: ExecutionContext) => Promise<Record<string, unknown>>
  ): void {
    this.actionHandlers.set(type, handler);
  }

  /**
   * Create a workflow
   */
  createWorkflow(workflow: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'version'>): WorkflowDefinition {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    const fullWorkflow: WorkflowDefinition = {
      ...workflow,
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    
    this.workflows.set(id, fullWorkflow);
    return fullWorkflow;
  }

  /**
   * Create workflow from template
   */
  createFromTemplate(
    templateId: string,
    tenantId: string,
    createdBy: string,
    customizations?: {
      name?: string;
      variables?: Record<string, unknown>;
    }
  ): WorkflowDefinition | null {
    const template = WorkflowTemplates.find(t => t.id === templateId);
    if (!template) return null;

    return this.createWorkflow({
      tenantId,
      name: customizations?.name ?? template.name,
      description: template.description,
      status: WorkflowStatus.DRAFT,
      trigger: template.trigger,
      actions: template.actions,
      startActionId: template.startActionId,
      variables: { ...template.variables, ...customizations?.variables },
      createdBy,
    });
  }

  /**
   * Update workflow
   */
  updateWorkflow(
    workflowId: string,
    updates: Partial<Omit<WorkflowDefinition, 'id' | 'tenantId' | 'createdAt' | 'createdBy'>>
  ): WorkflowDefinition | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    const updated: WorkflowDefinition = {
      ...workflow,
      ...updates,
      version: workflow.version + 1,
      updatedAt: new Date().toISOString(),
    };
    
    this.workflows.set(workflowId, updated);
    return updated;
  }

  /**
   * Trigger a workflow execution
   */
  async triggerWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>
  ): Promise<WorkflowExecution | null> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.status !== WorkflowStatus.ACTIVE) {
      return null;
    }

    const execution: WorkflowExecution = {
      id: crypto.randomUUID(),
      workflowId,
      workflowVersion: workflow.version,
      tenantId: workflow.tenantId,
      status: ExecutionStatus.PENDING,
      triggerData,
      variables: { ...workflow.variables },
      currentActionId: workflow.startActionId,
      actionResults: [],
      startedAt: new Date().toISOString(),
    };

    this.executions.set(execution.id, execution);
    
    // Start execution
    await this.executeWorkflow(execution.id);
    
    return this.executions.get(execution.id)!;
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(executionId: string): Promise<void> {
    let execution = this.executions.get(executionId);
    if (!execution) return;

    const workflow = this.workflows.get(execution.workflowId);
    if (!workflow) return;

    // Update status to running
    execution = { ...execution, status: ExecutionStatus.RUNNING };
    this.executions.set(executionId, execution);

    try {
      let currentActionId = execution.currentActionId;

      while (currentActionId) {
        const action = workflow.actions.find(a => a.id === currentActionId);
        if (!action) break;

        const result = await this.executeAction(action, execution, workflow);
        
        // Update execution with result
        const actionResults = [...execution.actionResults, result];
        execution = {
          ...execution,
          actionResults,
          currentActionId: result.status === 'completed' ? undefined : currentActionId,
        };
        this.executions.set(executionId, execution);

        if (result.status !== 'completed') {
          // Action failed or is waiting
          if (result.status === 'failed') {
            execution = { ...execution, status: ExecutionStatus.FAILED, error: result.error };
            this.executions.set(executionId, execution);
            return;
          }
          break;
        }

        // Determine next action
        if (action.type === ActionType.CONDITIONAL && result.output?.branch) {
          currentActionId = result.output.branch as string;
        } else {
          currentActionId = action.nextActions?.[0];
        }
      }

      // Workflow completed
      execution = {
        ...execution,
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date().toISOString(),
      };
      this.executions.set(executionId, execution);
    } catch (error) {
      execution = {
        ...execution,
        status: ExecutionStatus.FAILED,
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date().toISOString(),
      };
      this.executions.set(executionId, execution);
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: WorkflowAction,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<ActionResult> {
    const startedAt = new Date().toISOString();
    const context: ExecutionContext = {
      variables: execution.variables,
      triggerData: execution.triggerData,
      event: execution.triggerData,
      actionResults: execution.actionResults.reduce((acc, r) => {
        acc[r.actionId] = r.output ?? {};
        return acc;
      }, {} as Record<string, unknown>),
    };

    const handler = this.actionHandlers.get(action.type);
    if (!handler) {
      return {
        actionId: action.id,
        actionType: action.type,
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: `No handler for action type: ${action.type}`,
        retryCount: 0,
      };
    }

    let retryCount = 0;
    const maxRetries = action.retries ?? 0;

    while (retryCount <= maxRetries) {
      try {
        const output = await Promise.race([
          handler(action, context),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Action timeout')), action.timeout ?? 30000)
          ),
        ]);

        return {
          actionId: action.id,
          actionType: action.type,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          output,
          retryCount,
        };
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          if (action.onError === 'continue') {
            return {
              actionId: action.id,
              actionType: action.type,
              status: 'completed',
              startedAt,
              completedAt: new Date().toISOString(),
              output: { skippedDueToError: true },
              error: error instanceof Error ? error.message : 'Unknown error',
              retryCount,
            };
          }
          return {
            actionId: action.id,
            actionType: action.type,
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            retryCount,
          };
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // Should never reach here
    return {
      actionId: action.id,
      actionType: action.type,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: 'Unexpected error',
      retryCount,
    };
  }

  /**
   * Interpolate variables in a value
   */
  private interpolate(value: unknown, context: ExecutionContext): unknown {
    if (typeof value === 'string') {
      return value.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
        const parts = path.trim().split('.');
        let current: unknown = context;
        for (const part of parts) {
          if (current && typeof current === 'object') {
            current = (current as Record<string, unknown>)[part];
          } else {
            return '';
          }
        }
        return String(current ?? '');
      });
    }
    if (Array.isArray(value)) {
      return value.map(v => this.interpolate(v, context));
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.interpolate(v, context);
      }
      return result;
    }
    return value;
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    // Simple condition evaluation - in production would use a proper expression evaluator
    const interpolated = this.interpolate(condition, context) as string;
    
    // Basic comparisons
    const match = interpolated.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (match) {
      const [, left, op, right] = match;
      const leftVal = left.trim();
      const rightVal = right.trim().replace(/^["']|["']$/g, '');
      
      switch (op) {
        case '==': return leftVal === rightVal;
        case '!=': return leftVal !== rightVal;
        case '>=': return Number(leftVal) >= Number(rightVal);
        case '<=': return Number(leftVal) <= Number(rightVal);
        case '>': return Number(leftVal) > Number(rightVal);
        case '<': return Number(leftVal) < Number(rightVal);
      }
    }
    
    // Boolean check
    return Boolean(interpolated);
  }

  /**
   * Get workflows for a tenant
   */
  getWorkflowsForTenant(tenantId: string): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).filter(w => w.tenantId === tenantId);
  }

  /**
   * Get execution history for a workflow
   */
  getExecutionHistory(workflowId: string, limit: number = 100): WorkflowExecution[] {
    return Array.from(this.executions.values())
      .filter(e => e.workflowId === workflowId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  /**
   * Get available templates
   */
  getTemplates(category?: string): WorkflowTemplate[] {
    if (!category) return WorkflowTemplates;
    return WorkflowTemplates.filter(t => t.category === category);
  }
}

/**
 * Execution context passed to action handlers
 */
export interface ExecutionContext {
  readonly variables: Record<string, unknown>;
  readonly triggerData: Record<string, unknown>;
  readonly event: Record<string, unknown>;
  readonly actionResults: Record<string, unknown>;
}

/**
 * Zod schemas for API validation
 */
export const WorkflowTriggerSchema = z.object({
  type: z.nativeEnum(TriggerType),
  config: z.object({
    eventType: z.string().optional(),
    eventFilter: z.record(z.unknown()).optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    webhookPath: z.string().optional(),
    conditionQuery: z.string().optional(),
    checkInterval: z.number().optional(),
  }),
});

export const WorkflowActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.nativeEnum(ActionType),
  config: z.record(z.unknown()),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  onError: z.enum(['fail', 'continue', 'retry']).optional(),
  nextActions: z.array(z.string()).optional(),
  conditionalBranches: z.array(z.object({
    condition: z.string(),
    nextAction: z.string(),
  })).optional(),
});

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000),
  trigger: WorkflowTriggerSchema,
  actions: z.array(WorkflowActionSchema).min(1),
  startActionId: z.string(),
  variables: z.record(z.unknown()).optional(),
});
