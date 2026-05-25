/**
 * Disbursement Job
 * Background job for automated owner disbursements
 */
import { TenantId, OwnerId } from '@borjie/domain-models';
import {
  DisbursementService,
  DisbursementResult
} from '../services/disbursement.service';
import { ILogger } from '../services/payment-orchestration.service';

/**
 * Job configuration
 */
export interface DisbursementJobConfig {
  // Schedule type: 'daily', 'weekly', 'monthly'
  schedule: 'daily' | 'weekly' | 'monthly';
  // Day of week for weekly (0 = Sunday)
  dayOfWeek?: number;
  // Day of month for monthly (1-28)
  dayOfMonth?: number;
  // Minimum balance for disbursement (in minor units)
  minimumBalance: number;
  // Maximum disbursements per batch
  batchSize: number;
  // Delay between disbursements (ms) to avoid rate limits
  delayBetweenMs: number;
}

/**
 * Job result
 */
export interface DisbursementJobResult {
  jobId: string;
  tenantId: TenantId;
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  totalOwners: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  totalDisbursed: number;  // In minor units
  currency?: string;
  results: DisbursementResult[];
  errors?: string[];
}

/**
 * Disbursement Job
 * Handles scheduled disbursements to property owners
 */
export class DisbursementJob {
  private disbursementService: DisbursementService;
  private logger: ILogger;
  private config: DisbursementJobConfig;

  constructor(
    disbursementService: DisbursementService,
    logger: ILogger,
    config?: Partial<DisbursementJobConfig>
  ) {
    this.disbursementService = disbursementService;
    this.logger = logger;
    this.config = {
      schedule: 'weekly',
      dayOfWeek: 1, // Monday
      dayOfMonth: 1,
      minimumBalance: 1000,
      batchSize: 50,
      delayBetweenMs: 500,
      ...config
    };
  }

  /**
   * Run scheduled disbursements for a tenant
   */
  async runScheduledDisbursements(
    tenantId: TenantId,
    ownerDestinations: Map<OwnerId, string>  // Map of owner ID to payout destination
  ): Promise<DisbursementJobResult> {
    const jobId = `disb_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting scheduled disbursement job', {
      jobId,
      tenantId,
      ownerCount: ownerDestinations.size
    });

    // Get eligible owners
    const eligibleOwners = await this.disbursementService.getEligibleOwners(
      tenantId,
      this.config.minimumBalance
    );

    const results: DisbursementResult[] = [];
    const errors: string[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalDisbursed = 0;
    let currency: string | undefined;

    for (const owner of eligibleOwners.slice(0, this.config.batchSize)) {
      // Check if we have a destination for this owner
      const destination = ownerDestinations.get(owner.ownerId);
      if (!destination) {
        skippedCount++;
        this.logger.warn('No payout destination for owner', {
          jobId,
          ownerId: owner.ownerId
        });
        continue;
      }

      try {
        const result = await this.disbursementService.processDisbursement({
          tenantId,
          ownerId: owner.ownerId,
          destination
        });

        results.push(result);

        if (result.status !== 'FAILED') {
          succeededCount++;
          totalDisbursed += result.amount.amountMinorUnits;
          currency = result.amount.currency;
        } else {
          failedCount++;
          if (result.failureReason) {
            errors.push(`Owner ${owner.ownerId}: ${result.failureReason}`);
          }
        }

        // Rate limiting delay
        if (this.config.delayBetweenMs > 0) {
          await this.delay(this.config.delayBetweenMs);
        }
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Owner ${owner.ownerId}: ${errorMessage}`);
        
        this.logger.error('Disbursement failed', {
          jobId,
          ownerId: owner.ownerId,
          error: errorMessage
        });
      }
    }

    this.logger.info('Scheduled disbursement job completed', {
      jobId,
      tenantId,
      totalOwners: eligibleOwners.length,
      processed: succeededCount + failedCount,
      succeeded: succeededCount,
      failed: failedCount,
      skipped: skippedCount,
      totalDisbursed
    });

    return {
      jobId,
      tenantId,
      startedAt,
      completedAt: new Date(),
      success: failedCount === 0,
      totalOwners: eligibleOwners.length,
      processedCount: succeededCount + failedCount,
      succeededCount,
      failedCount,
      skippedCount,
      totalDisbursed,
      currency,
      results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Run disbursement for a single owner
   */
  async runSingleDisbursement(
    tenantId: TenantId,
    ownerId: OwnerId,
    destination: string
  ): Promise<DisbursementResult> {
    this.logger.info('Processing single disbursement', {
      tenantId,
      ownerId
    });

    return this.disbursementService.processDisbursement({
      tenantId,
      ownerId,
      destination
    });
  }

  /**
   * Check if it's time to run scheduled disbursements
   */
  shouldRunDisbursements(): boolean {
    const now = new Date();

    switch (this.config.schedule) {
      case 'daily':
        return true;
      case 'weekly':
        return now.getDay() === this.config.dayOfWeek;
      case 'monthly':
        return now.getDate() === this.config.dayOfMonth;
      default:
        return false;
    }
  }

  /**
   * Get estimated next run date
   */
  getNextRunDate(): Date {
    const now = new Date();
    const next = new Date(now);

    switch (this.config.schedule) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly': {
        const daysUntilNext = (this.config.dayOfWeek! - now.getDay() + 7) % 7;
        next.setDate(next.getDate() + (daysUntilNext || 7));
        break;
      }
      case 'monthly':
        if (now.getDate() >= this.config.dayOfMonth!) {
          next.setMonth(next.getMonth() + 1);
        }
        next.setDate(this.config.dayOfMonth!);
        break;
    }

    next.setHours(0, 0, 0, 0);
    return next;
  }

  /**
   * Get job configuration
   */
  getConfig(): DisbursementJobConfig {
    return { ...this.config };
  }

  /**
   * Update job configuration
   */
  updateConfig(config: Partial<DisbursementJobConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
