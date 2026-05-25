/**
 * Disaster Recovery Framework
 * 
 * Implements disaster recovery patterns including:
 * - Multi-region failover coordination
 * - Backup verification and restoration
 * - Recovery Point Objective (RPO) and Recovery Time Objective (RTO) tracking
 * - DR drill orchestration and reporting
 */

import { z } from 'zod';

/**
 * Region Status
 */
export const RegionStatus = {
  ACTIVE: 'ACTIVE',           // Primary region, serving traffic
  STANDBY: 'STANDBY',         // Ready to take over
  DEGRADED: 'DEGRADED',       // Partially functional
  OFFLINE: 'OFFLINE',         // Not available
  FAILOVER_IN_PROGRESS: 'FAILOVER_IN_PROGRESS',
  RECOVERY_IN_PROGRESS: 'RECOVERY_IN_PROGRESS',
} as const;

export type RegionStatus = typeof RegionStatus[keyof typeof RegionStatus];

/**
 * Failover Mode
 */
export const FailoverMode = {
  AUTOMATIC: 'AUTOMATIC',     // System-triggered failover
  MANUAL: 'MANUAL',           // Operator-triggered failover
  SCHEDULED: 'SCHEDULED',     // Planned maintenance failover
} as const;

export type FailoverMode = typeof FailoverMode[keyof typeof FailoverMode];

/**
 * Backup Type
 */
export const BackupType = {
  FULL: 'FULL',               // Complete backup
  INCREMENTAL: 'INCREMENTAL', // Changes since last backup
  DIFFERENTIAL: 'DIFFERENTIAL', // Changes since last full backup
  SNAPSHOT: 'SNAPSHOT',       // Point-in-time snapshot
  LOG: 'LOG',                 // Transaction log backup
} as const;

export type BackupType = typeof BackupType[keyof typeof BackupType];

/**
 * Recovery Type
 */
export const RecoveryType = {
  FULL_RESTORE: 'FULL_RESTORE',
  POINT_IN_TIME: 'POINT_IN_TIME',
  TABLE_LEVEL: 'TABLE_LEVEL',
  OBJECT_LEVEL: 'OBJECT_LEVEL',
} as const;

export type RecoveryType = typeof RecoveryType[keyof typeof RecoveryType];

/**
 * Region Configuration
 */
export interface RegionConfig {
  readonly id: string;
  readonly name: string;
  readonly provider: string;          // e.g., 'aws', 'gcp', 'azure'
  readonly location: string;          // Cloud-provider region identifier — value sourced from jurisdictional-rules.awsRegionDefault per tenant
  readonly isPrimary: boolean;
  readonly priority: number;          // Lower = higher priority for failover
  readonly endpoints: {
    readonly api: string;
    readonly database: string;
    readonly storage: string;
  };
  readonly healthEndpoint: string;
  readonly status: RegionStatus;
  readonly lastHealthCheck: string;
  readonly replicationLag?: number;   // In milliseconds
}

/**
 * Backup Record
 */
export interface BackupRecord {
  readonly id: string;
  readonly type: BackupType;
  readonly source: string;            // e.g., 'database', 'file-storage'
  readonly tenantId?: string;         // For tenant-specific backups
  readonly regionId: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly location: string;          // Storage path/URI
  readonly retention: {
    readonly expiresAt: string;
    readonly policy: string;
  };
  readonly verified: boolean;
  readonly verifiedAt?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Recovery Plan
 */
export interface RecoveryPlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetRpo: number;         // Target RPO in minutes
  readonly targetRto: number;         // Target RTO in minutes
  readonly steps: readonly RecoveryStep[];
  readonly notifications: readonly NotificationConfig[];
  readonly runbooks: readonly string[];
  readonly lastTested?: string;
  readonly testResult?: 'pass' | 'fail';
}

export interface RecoveryStep {
  readonly order: number;
  readonly name: string;
  readonly description: string;
  readonly automated: boolean;
  readonly estimatedDuration: number; // In minutes
  readonly dependencies: readonly number[]; // Other step orders
  readonly runbook?: string;
}

export interface NotificationConfig {
  readonly channel: 'email' | 'sms' | 'slack' | 'pagerduty' | 'webhook';
  readonly recipients: readonly string[];
  readonly triggerOn: ('failover_start' | 'failover_complete' | 'recovery_start' | 'recovery_complete' | 'drill_start' | 'drill_complete')[];
}

/**
 * Failover Event
 */
export interface FailoverEvent {
  readonly id: string;
  readonly mode: FailoverMode;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly triggeredBy: string;       // User ID or 'system'
  readonly triggeredAt: string;
  readonly completedAt?: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  readonly reason: string;
  readonly steps: readonly {
    readonly name: string;
    readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly error?: string;
  }[];
  readonly metrics?: {
    readonly actualRto?: number;      // Actual RTO achieved in minutes
    readonly dataLoss?: number;       // Data loss in minutes (RPO)
    readonly affectedUsers?: number;
  };
}

/**
 * DR Drill
 */
export interface DRDrill {
  readonly id: string;
  readonly planId: string;
  readonly type: 'tabletop' | 'partial' | 'full';
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly status: 'scheduled' | 'in_progress' | 'completed' | 'aborted';
  readonly participants: readonly string[];
  readonly results?: {
    readonly rtoAchieved: number;
    readonly rpoAchieved: number;
    readonly stepsCompleted: number;
    readonly stepsFailed: number;
    readonly findings: readonly string[];
    readonly recommendations: readonly string[];
  };
}

/**
 * RPO/RTO Metrics
 */
export interface RecoveryMetrics {
  readonly measuredAt: string;
  readonly region: string;
  readonly currentRpo: number;        // Current RPO based on replication lag
  readonly targetRpo: number;
  readonly rpoCompliant: boolean;
  readonly estimatedRto: number;      // Estimated RTO based on last drill
  readonly targetRto: number;
  readonly rtoConfidence: number;     // 0-100 confidence in RTO estimate
  readonly lastBackup: {
    readonly timestamp: string;
    readonly type: BackupType;
    readonly verified: boolean;
  };
  readonly replicationStatus: {
    readonly lag: number;
    readonly healthy: boolean;
    readonly lastSync: string;
  };
}

/**
 * Disaster Recovery Manager
 */
export class DisasterRecoveryManager {
  private regions: Map<string, RegionConfig> = new Map();
  private backups: Map<string, BackupRecord> = new Map();
  private recoveryPlans: Map<string, RecoveryPlan> = new Map();
  private failoverHistory: FailoverEvent[] = [];
  private drills: Map<string, DRDrill> = new Map();

  /**
   * Register a region
   */
  registerRegion(region: RegionConfig): void {
    this.regions.set(region.id, region);
  }

  /**
   * Get current primary region
   */
  getPrimaryRegion(): RegionConfig | undefined {
    return Array.from(this.regions.values()).find(r => r.isPrimary && r.status === RegionStatus.ACTIVE);
  }

  /**
   * Get best failover target
   */
  getFailoverTarget(): RegionConfig | undefined {
    return Array.from(this.regions.values())
      .filter(r => !r.isPrimary && r.status === RegionStatus.STANDBY)
      .sort((a, b) => a.priority - b.priority)[0];
  }

  /**
   * Initiate failover
   */
  initiateFailover(
    toRegionId: string,
    mode: FailoverMode,
    triggeredBy: string,
    reason: string
  ): FailoverEvent {
    const fromRegion = this.getPrimaryRegion();
    const toRegion = this.regions.get(toRegionId);

    if (!fromRegion || !toRegion) {
      throw new Error('Invalid failover configuration');
    }

    const event: FailoverEvent = {
      id: crypto.randomUUID(),
      mode,
      fromRegion: fromRegion.id,
      toRegion: toRegionId,
      triggeredBy,
      triggeredAt: new Date().toISOString(),
      status: 'pending',
      reason,
      steps: [
        { name: 'Validate target region', status: 'pending' },
        { name: 'Stop writes to primary', status: 'pending' },
        { name: 'Sync final transactions', status: 'pending' },
        { name: 'Update DNS/routing', status: 'pending' },
        { name: 'Activate standby', status: 'pending' },
        { name: 'Verify services', status: 'pending' },
        { name: 'Resume traffic', status: 'pending' },
      ],
    };

    this.failoverHistory.push(event);
    return event;
  }

  /**
   * Record a backup
   */
  recordBackup(backup: BackupRecord): void {
    this.backups.set(backup.id, backup);
  }

  /**
   * Get latest backup for a source
   */
  getLatestBackup(source: string, type?: BackupType): BackupRecord | undefined {
    return Array.from(this.backups.values())
      .filter(b => b.source === source && (!type || b.type === type) && b.completedAt)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  }

  /**
   * Verify a backup
   */
  async verifyBackup(backupId: string, verifyFn: (backup: BackupRecord) => Promise<boolean>): Promise<boolean> {
    const backup = this.backups.get(backupId);
    if (!backup) return false;

    const verified = await verifyFn(backup);
    
    this.backups.set(backupId, {
      ...backup,
      verified,
      verifiedAt: new Date().toISOString(),
    });

    return verified;
  }

  /**
   * Register a recovery plan
   */
  registerRecoveryPlan(plan: RecoveryPlan): void {
    this.recoveryPlans.set(plan.id, plan);
  }

  /**
   * Schedule a DR drill
   */
  scheduleDrill(
    planId: string,
    type: DRDrill['type'],
    scheduledAt: string,
    participants: string[]
  ): DRDrill {
    const drill: DRDrill = {
      id: crypto.randomUUID(),
      planId,
      type,
      scheduledAt,
      status: 'scheduled',
      participants,
    };
    this.drills.set(drill.id, drill);
    return drill;
  }

  /**
   * Record drill results
   */
  completeDrill(
    drillId: string,
    results: NonNullable<DRDrill['results']>
  ): DRDrill | null {
    const drill = this.drills.get(drillId);
    if (!drill) return null;

    const updated: DRDrill = {
      ...drill,
      completedAt: new Date().toISOString(),
      status: 'completed',
      results,
    };

    this.drills.set(drillId, updated);

    // Update recovery plan with test results
    const plan = this.recoveryPlans.get(drill.planId);
    if (plan) {
      this.recoveryPlans.set(plan.id, {
        ...plan,
        lastTested: updated.completedAt,
        testResult: results.stepsFailed === 0 ? 'pass' : 'fail',
      });
    }

    return updated;
  }

  /**
   * Calculate current recovery metrics
   */
  getRecoveryMetrics(regionId: string): RecoveryMetrics | null {
    const region = this.regions.get(regionId);
    if (!region) return null;

    const latestBackup = this.getLatestBackup('database', BackupType.FULL);
    const plan = Array.from(this.recoveryPlans.values())[0]; // Get first plan

    // Calculate RPO from replication lag
    const currentRpo = region.replicationLag ? Math.ceil(region.replicationLag / 60000) : 0;
    const targetRpo = plan?.targetRpo ?? 15;

    // Estimate RTO from last drill
    const lastDrill = Array.from(this.drills.values())
      .filter(d => d.results && d.status === 'completed')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];

    const estimatedRto = lastDrill?.results?.rtoAchieved ?? plan?.targetRto ?? 60;
    const targetRto = plan?.targetRto ?? 60;

    return {
      measuredAt: new Date().toISOString(),
      region: regionId,
      currentRpo,
      targetRpo,
      rpoCompliant: currentRpo <= targetRpo,
      estimatedRto,
      targetRto,
      rtoConfidence: lastDrill ? 80 : 50, // Higher confidence if we have drill data
      lastBackup: latestBackup ? {
        timestamp: latestBackup.completedAt ?? latestBackup.createdAt,
        type: latestBackup.type,
        verified: latestBackup.verified,
      } : {
        timestamp: 'never',
        type: BackupType.FULL,
        verified: false,
      },
      replicationStatus: {
        lag: region.replicationLag ?? 0,
        healthy: (region.replicationLag ?? 0) < 60000, // < 1 minute
        lastSync: region.lastHealthCheck,
      },
    };
  }

  /**
   * Get DR compliance report
   */
  getComplianceReport(): {
    overallStatus: 'compliant' | 'at_risk' | 'non_compliant';
    regions: Array<{
      region: RegionConfig;
      metrics: RecoveryMetrics | null;
    }>;
    backupCompliance: {
      totalBackups: number;
      verifiedBackups: number;
      expiredBackups: number;
    };
    drillCompliance: {
      lastDrillDate?: string;
      daysSinceLastDrill?: number;
      requiredDrillFrequencyDays: number;
      compliant: boolean;
    };
    failoverHistory: {
      last30Days: number;
      lastFailover?: FailoverEvent;
    };
  } {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Region metrics
    const regionMetrics = Array.from(this.regions.values()).map(region => ({
      region,
      metrics: this.getRecoveryMetrics(region.id),
    }));

    // Backup compliance
    const backups = Array.from(this.backups.values());
    const verifiedBackups = backups.filter(b => b.verified).length;
    const expiredBackups = backups.filter(b => new Date(b.retention.expiresAt) < now).length;

    // Drill compliance
    const completedDrills = Array.from(this.drills.values())
      .filter(d => d.status === 'completed')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    const lastDrill = completedDrills[0];
    const daysSinceLastDrill = lastDrill?.completedAt
      ? Math.ceil((now.getTime() - new Date(lastDrill.completedAt).getTime()) / (24 * 60 * 60 * 1000))
      : undefined;
    const requiredDrillFrequencyDays = 90; // Quarterly drills

    // Failover history
    const recentFailovers = this.failoverHistory.filter(
      f => new Date(f.triggeredAt) > thirtyDaysAgo
    );

    // Overall status
    const rpoViolations = regionMetrics.filter(r => r.metrics && !r.metrics.rpoCompliant).length;
    const drillCompliant = daysSinceLastDrill !== undefined && daysSinceLastDrill <= requiredDrillFrequencyDays;
    
    let overallStatus: 'compliant' | 'at_risk' | 'non_compliant' = 'compliant';
    if (rpoViolations > 0 || !drillCompliant) {
      overallStatus = 'at_risk';
    }
    if (rpoViolations > regionMetrics.length / 2) {
      overallStatus = 'non_compliant';
    }

    return {
      overallStatus,
      regions: regionMetrics,
      backupCompliance: {
        totalBackups: backups.length,
        verifiedBackups,
        expiredBackups,
      },
      drillCompliance: {
        lastDrillDate: lastDrill?.completedAt,
        daysSinceLastDrill,
        requiredDrillFrequencyDays,
        compliant: drillCompliant,
      },
      failoverHistory: {
        last30Days: recentFailovers.length,
        lastFailover: this.failoverHistory[this.failoverHistory.length - 1],
      },
    };
  }
}

/**
 * Zod schemas for API validation
 */
export const FailoverRequestSchema = z.object({
  toRegionId: z.string(),
  mode: z.nativeEnum(FailoverMode),
  reason: z.string().min(10).max(500),
});

export const DrillScheduleSchema = z.object({
  planId: z.string(),
  type: z.enum(['tabletop', 'partial', 'full']),
  scheduledAt: z.string().datetime(),
  participants: z.array(z.string().email()),
});

export const DrillResultsSchema = z.object({
  rtoAchieved: z.number().min(0),
  rpoAchieved: z.number().min(0),
  stepsCompleted: z.number().min(0),
  stepsFailed: z.number().min(0),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
});
