/**
 * Data Retention Policy Engine
 * 
 * Implements automated data lifecycle management with configurable retention
 * policies, legal hold support, and compliance-driven purge operations.
 */

import { z } from 'zod';

/**
 * Retention Policy Types
 */
export const RetentionPolicyType = {
  TIME_BASED: 'TIME_BASED',           // Delete after X days
  EVENT_BASED: 'EVENT_BASED',         // Delete X days after event (e.g., lease end)
  LEGAL_REQUIREMENT: 'LEGAL_REQUIREMENT', // Retain for legal/regulatory requirement
  INDEFINITE: 'INDEFINITE',           // Keep forever (with periodic review)
} as const;

export type RetentionPolicyType = typeof RetentionPolicyType[keyof typeof RetentionPolicyType];

/**
 * Data Lifecycle Stage
 */
export const LifecycleStage = {
  ACTIVE: 'ACTIVE',                   // In regular use
  ARCHIVED: 'ARCHIVED',               // Moved to cold storage
  PENDING_DELETION: 'PENDING_DELETION', // Scheduled for deletion
  DELETED: 'DELETED',                 // Soft deleted, pending purge
  PURGED: 'PURGED',                   // Permanently removed
  LEGAL_HOLD: 'LEGAL_HOLD',           // Preserved due to legal hold
} as const;

export type LifecycleStage = typeof LifecycleStage[keyof typeof LifecycleStage];

/**
 * Data Classification for Retention
 */
export const RetentionClassification = {
  OPERATIONAL: 'OPERATIONAL',         // Day-to-day operational data
  FINANCIAL: 'FINANCIAL',             // Financial records (longer retention)
  LEGAL: 'LEGAL',                     // Legal documents and contracts
  AUDIT: 'AUDIT',                     // Audit logs and compliance records
  PII: 'PII',                         // Personal identifiable information
  BACKUP: 'BACKUP',                   // System backups
  ANALYTICS: 'ANALYTICS',             // Aggregated analytics data
} as const;

export type RetentionClassification = typeof RetentionClassification[keyof typeof RetentionClassification];

/**
 * Retention Policy Definition
 */
export interface RetentionPolicy {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly classification: RetentionClassification;
  readonly policyType: RetentionPolicyType;
  readonly retentionPeriodDays: number;
  readonly archiveAfterDays?: number;
  readonly triggerEvent?: string;
  readonly legalBasis?: string;
  readonly jurisdiction?: string;
  readonly enabled: boolean;
  readonly appliesTo: readonly RetentionScope[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Scope definition for where policy applies
 */
export interface RetentionScope {
  readonly entityType: string;
  readonly tenantId?: string;
  readonly fieldPatterns?: readonly string[];
  readonly excludePatterns?: readonly string[];
}

/**
 * Legal Hold Definition
 */
export interface LegalHold {
  readonly id: string;
  readonly name: string;
  readonly matter: string;
  readonly custodianId: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly status: 'active' | 'released' | 'expired';
  readonly scope: {
    readonly tenantIds?: readonly string[];
    readonly entityTypes?: readonly string[];
    readonly dateRangeStart?: string;
    readonly dateRangeEnd?: string;
    readonly customCriteria?: Record<string, unknown>;
  };
  readonly notes?: string;
}

/**
 * Retention Job Record
 */
export interface RetentionJob {
  readonly id: string;
  readonly jobType: 'archive' | 'delete' | 'purge' | 'audit';
  readonly policyId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly recordsProcessed: number;
  readonly recordsAffected: number;
  readonly errors: readonly string[];
  readonly dryRun: boolean;
}

/**
 * Retention Schedule Entry
 */
export interface RetentionScheduleEntry {
  readonly entityType: string;
  readonly entityId: string;
  readonly tenantId: string;
  readonly currentStage: LifecycleStage;
  readonly scheduledAction: 'archive' | 'delete' | 'purge' | 'review';
  readonly scheduledAt: string;
  readonly policyId: string;
  readonly legalHoldIds: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Pre-defined retention policies for property management domain
 */
export const DefaultRetentionPolicies: Record<string, Omit<RetentionPolicy, 'id' | 'createdAt' | 'updatedAt'>> = {
  // Financial records - 7 years (IRS requirement)
  FINANCIAL_RECORDS: {
    name: 'Financial Records Retention',
    description: 'Retain financial records for 7 years per IRS requirements',
    classification: RetentionClassification.FINANCIAL,
    policyType: RetentionPolicyType.LEGAL_REQUIREMENT,
    retentionPeriodDays: 2555, // ~7 years
    archiveAfterDays: 365,
    legalBasis: 'IRS Record Keeping Requirements',
    jurisdiction: 'US',
    enabled: true,
    appliesTo: [
      { entityType: 'LedgerEntry' },
      { entityType: 'Payment' },
      { entityType: 'Invoice' },
      { entityType: 'Statement' },
      { entityType: 'Disbursement' },
    ],
  },

  // Lease documents - 6 years after lease end
  LEASE_DOCUMENTS: {
    name: 'Lease Document Retention',
    description: 'Retain lease documents for 6 years after lease termination',
    classification: RetentionClassification.LEGAL,
    policyType: RetentionPolicyType.EVENT_BASED,
    retentionPeriodDays: 2190, // ~6 years
    archiveAfterDays: 90,
    triggerEvent: 'lease.terminated',
    legalBasis: 'Statute of Limitations',
    enabled: true,
    appliesTo: [
      { entityType: 'Lease' },
      { entityType: 'LeaseDocument' },
      { entityType: 'LeaseAmendment' },
    ],
  },

  // Audit logs - 3 years
  AUDIT_LOGS: {
    name: 'Audit Log Retention',
    description: 'Retain audit logs for 3 years for compliance',
    classification: RetentionClassification.AUDIT,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 1095, // ~3 years
    archiveAfterDays: 180,
    legalBasis: 'SOC 2 Compliance',
    enabled: true,
    appliesTo: [
      { entityType: 'AuditEvent' },
      { entityType: 'SecurityLog' },
    ],
  },

  // PII data - minimize retention
  PII_MINIMIZATION: {
    name: 'PII Data Minimization',
    description: 'Minimize PII retention per GDPR principle',
    classification: RetentionClassification.PII,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 365, // 1 year after relationship ends
    triggerEvent: 'customer.inactive',
    legalBasis: 'GDPR Data Minimization',
    enabled: true,
    appliesTo: [
      { entityType: 'Customer', fieldPatterns: ['*.pii.*'] },
      { entityType: 'Prospect' },
    ],
  },

  // Work orders - 2 years
  MAINTENANCE_RECORDS: {
    name: 'Maintenance Record Retention',
    description: 'Retain maintenance records for 2 years',
    classification: RetentionClassification.OPERATIONAL,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 730, // 2 years
    archiveAfterDays: 365,
    enabled: true,
    appliesTo: [
      { entityType: 'WorkOrder' },
      { entityType: 'Inspection' },
      { entityType: 'MaintenanceRequest' },
    ],
  },

  // Backups - 90 days
  BACKUP_RETENTION: {
    name: 'Backup Retention',
    description: 'Retain database backups for 90 days',
    classification: RetentionClassification.BACKUP,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 90,
    enabled: true,
    appliesTo: [
      { entityType: 'DatabaseBackup' },
      { entityType: 'FileBackup' },
    ],
  },

  // Analytics data - aggregated, 5 years
  ANALYTICS_DATA: {
    name: 'Analytics Data Retention',
    description: 'Retain aggregated analytics for trend analysis',
    classification: RetentionClassification.ANALYTICS,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 1825, // 5 years
    enabled: true,
    appliesTo: [
      { entityType: 'AnalyticsEvent' },
      { entityType: 'KPISnapshot' },
    ],
  },

  // Communication logs - 1 year
  COMMUNICATION_LOGS: {
    name: 'Communication Log Retention',
    description: 'Retain communication logs for 1 year',
    classification: RetentionClassification.OPERATIONAL,
    policyType: RetentionPolicyType.TIME_BASED,
    retentionPeriodDays: 365,
    archiveAfterDays: 90,
    enabled: true,
    appliesTo: [
      { entityType: 'Message' },
      { entityType: 'Notification' },
      { entityType: 'EmailLog' },
    ],
  },
};

/**
 * Data Retention Manager
 * Orchestrates retention policy enforcement and data lifecycle management
 */
export class DataRetentionManager {
  private policies: Map<string, RetentionPolicy> = new Map();
  private legalHolds: Map<string, LegalHold> = new Map();
  private schedules: Map<string, RetentionScheduleEntry> = new Map();
  private jobs: Map<string, RetentionJob> = new Map();

  constructor() {
    // Initialize with default policies
    this.initializeDefaultPolicies();
  }

  private initializeDefaultPolicies(): void {
    const now = new Date().toISOString();
    for (const [key, policy] of Object.entries(DefaultRetentionPolicies)) {
      const fullPolicy: RetentionPolicy = {
        ...policy,
        id: key,
        createdAt: now,
        updatedAt: now,
      };
      this.policies.set(key, fullPolicy);
    }
  }

  /**
   * Register a custom retention policy
   */
  registerPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Get applicable policy for an entity type
   */
  getPolicyForEntity(entityType: string, tenantId?: string): RetentionPolicy | null {
    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;
      
      for (const scope of policy.appliesTo) {
        if (scope.entityType === entityType) {
          if (!scope.tenantId || scope.tenantId === tenantId) {
            return policy;
          }
        }
      }
    }
    return null;
  }

  /**
   * Create a legal hold
   */
  createLegalHold(hold: Omit<LegalHold, 'id' | 'createdAt' | 'status'>): LegalHold {
    const id = crypto.randomUUID();
    const fullHold: LegalHold = {
      ...hold,
      id,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    this.legalHolds.set(id, fullHold);
    return fullHold;
  }

  /**
   * Release a legal hold
   */
  releaseLegalHold(holdId: string): boolean {
    const hold = this.legalHolds.get(holdId);
    if (!hold || hold.status !== 'active') return false;

    this.legalHolds.set(holdId, { ...hold, status: 'released' });
    return true;
  }

  /**
   * Check if entity is under legal hold
   */
  isUnderLegalHold(
    entityType: string,
    tenantId: string,
    createdAt: string
  ): { held: boolean; holdIds: string[] } {
    const holdIds: string[] = [];

    for (const hold of this.legalHolds.values()) {
      if (hold.status !== 'active') continue;

      // Check tenant scope
      if (hold.scope.tenantIds && !hold.scope.tenantIds.includes(tenantId)) {
        continue;
      }

      // Check entity type scope
      if (hold.scope.entityTypes && !hold.scope.entityTypes.includes(entityType)) {
        continue;
      }

      // Check date range
      if (hold.scope.dateRangeStart && createdAt < hold.scope.dateRangeStart) {
        continue;
      }
      if (hold.scope.dateRangeEnd && createdAt > hold.scope.dateRangeEnd) {
        continue;
      }

      holdIds.push(hold.id);
    }

    return { held: holdIds.length > 0, holdIds };
  }

  /**
   * Schedule an entity for retention action
   */
  scheduleRetention(entry: RetentionScheduleEntry): void {
    const key = `${entry.entityType}:${entry.entityId}`;
    this.schedules.set(key, entry);
  }

  /**
   * Get entities due for retention action
   */
  getEntitiesDueForAction(
    action: RetentionScheduleEntry['scheduledAction'],
    before: Date = new Date()
  ): RetentionScheduleEntry[] {
    const beforeIso = before.toISOString();
    return Array.from(this.schedules.values()).filter(
      e => e.scheduledAction === action && e.scheduledAt <= beforeIso && e.legalHoldIds.length === 0
    );
  }

  /**
   * Create a retention job
   */
  createJob(
    jobType: RetentionJob['jobType'],
    policyId: string,
    dryRun: boolean = true
  ): RetentionJob {
    const job: RetentionJob = {
      id: crypto.randomUUID(),
      jobType,
      policyId,
      status: 'pending',
      recordsProcessed: 0,
      recordsAffected: 0,
      errors: [],
      dryRun,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  /**
   * Update job progress
   */
  updateJobProgress(
    jobId: string,
    update: Partial<Pick<RetentionJob, 'status' | 'recordsProcessed' | 'recordsAffected' | 'errors' | 'startedAt' | 'completedAt'>>
  ): RetentionJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const updated = { ...job, ...update };
    this.jobs.set(jobId, updated);
    return updated;
  }

  /**
   * Calculate retention date for a record
   */
  calculateRetentionDate(
    policy: RetentionPolicy,
    createdAt: Date,
    triggerEventDate?: Date
  ): { archiveAt?: Date; deleteAt: Date } {
    const baseDate = policy.policyType === RetentionPolicyType.EVENT_BASED && triggerEventDate
      ? triggerEventDate
      : createdAt;

    const deleteAt = new Date(baseDate);
    deleteAt.setDate(deleteAt.getDate() + policy.retentionPeriodDays);

    let archiveAt: Date | undefined;
    if (policy.archiveAfterDays) {
      archiveAt = new Date(baseDate);
      archiveAt.setDate(archiveAt.getDate() + policy.archiveAfterDays);
    }

    return { archiveAt, deleteAt };
  }

  /**
   * Get retention policy compliance report
   */
  getComplianceReport(): {
    activePolicies: number;
    totalScheduledActions: number;
    pendingArchive: number;
    pendingDelete: number;
    underLegalHold: number;
    overdueActions: number;
    recentJobs: RetentionJob[];
  } {
    const now = new Date().toISOString();
    const schedules = Array.from(this.schedules.values());
    
    let pendingArchive = 0;
    let pendingDelete = 0;
    let underLegalHold = 0;
    let overdueActions = 0;

    for (const schedule of schedules) {
      if (schedule.legalHoldIds.length > 0) {
        underLegalHold++;
        continue;
      }

      if (schedule.scheduledAction === 'archive') {
        pendingArchive++;
      } else if (schedule.scheduledAction === 'delete' || schedule.scheduledAction === 'purge') {
        pendingDelete++;
      }

      if (schedule.scheduledAt < now) {
        overdueActions++;
      }
    }

    const recentJobs = Array.from(this.jobs.values())
      .sort((a, b) => (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? ''))
      .slice(0, 10);

    return {
      activePolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      totalScheduledActions: schedules.length,
      pendingArchive,
      pendingDelete,
      underLegalHold,
      overdueActions,
      recentJobs,
    };
  }

  /**
   * Export policy configuration for documentation
   */
  exportPolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values());
  }
}

/**
 * Zod schemas for API validation
 */
export const RetentionPolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000),
  classification: z.nativeEnum(RetentionClassification),
  policyType: z.nativeEnum(RetentionPolicyType),
  retentionPeriodDays: z.number().min(1).max(36500), // Max ~100 years
  archiveAfterDays: z.number().min(1).optional(),
  triggerEvent: z.string().optional(),
  legalBasis: z.string().optional(),
  jurisdiction: z.string().optional(),
  enabled: z.boolean(),
  appliesTo: z.array(z.object({
    entityType: z.string(),
    tenantId: z.string().optional(),
    fieldPatterns: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
  })).min(1),
});

export const LegalHoldSchema = z.object({
  name: z.string().min(1).max(200),
  matter: z.string().min(1).max(500),
  custodianId: z.string(),
  expiresAt: z.string().datetime().optional(),
  scope: z.object({
    tenantIds: z.array(z.string()).optional(),
    entityTypes: z.array(z.string()).optional(),
    dateRangeStart: z.string().datetime().optional(),
    dateRangeEnd: z.string().datetime().optional(),
    customCriteria: z.record(z.unknown()).optional(),
  }),
  notes: z.string().max(2000).optional(),
});
