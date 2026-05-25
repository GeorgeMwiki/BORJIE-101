/**
 * Reconciliation Job
 * Background job for automated reconciliation tasks
 */
import { TenantId, AccountId } from '@borjie/domain-models';
import { ReconciliationService, BankTransaction } from '../services/reconciliation.service';
import { ILogger } from '../services/payment-orchestration.service';

/**
 * Job configuration
 */
export interface ReconciliationJobConfig {
  // How often to run provider reconciliation (in minutes)
  providerReconciliationInterval: number;
  // How old payments should be before reconciliation (in minutes)
  paymentAgeThreshold: number;
  // How often to run ledger verification (in hours)
  ledgerVerificationInterval: number;
}

/**
 * Job result
 */
export interface ReconciliationJobResult {
  jobId: string;
  tenantId: TenantId;
  type: 'PROVIDER_RECONCILIATION' | 'LEDGER_VERIFICATION' | 'BANK_RECONCILIATION';
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  details: Record<string, unknown>;
  errors?: string[];
}

/**
 * Reconciliation Job
 * Handles scheduled reconciliation tasks
 */
export class ReconciliationJob {
  private reconciliationService: ReconciliationService;
  private logger: ILogger;
  private config: ReconciliationJobConfig;

  constructor(
    reconciliationService: ReconciliationService,
    logger: ILogger,
    config?: Partial<ReconciliationJobConfig>
  ) {
    this.reconciliationService = reconciliationService;
    this.logger = logger;
    this.config = {
      providerReconciliationInterval: 15,
      paymentAgeThreshold: 30,
      ledgerVerificationInterval: 24,
      ...config
    };
  }

  /**
   * Run provider reconciliation for a tenant
   */
  async runProviderReconciliation(
    tenantId: TenantId,
    providerName: string
  ): Promise<ReconciliationJobResult> {
    const jobId = `prov_rec_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting provider reconciliation job', {
      jobId,
      tenantId,
      providerName
    });

    try {
      const result = await this.reconciliationService.reconcileWithProvider(
        tenantId,
        providerName,
        this.config.paymentAgeThreshold
      );

      return {
        jobId,
        tenantId,
        type: 'PROVIDER_RECONCILIATION',
        startedAt,
        completedAt: new Date(),
        success: true,
        details: {
          providerName,
          checked: result.checked,
          updated: result.updated,
          failed: result.failed
        },
        errors: result.errors.length > 0 
          ? result.errors.map(e => `${e.paymentId}: ${e.error}`)
          : undefined
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Provider reconciliation job failed', {
        jobId,
        tenantId,
        error: errorMessage
      });

      return {
        jobId,
        tenantId,
        type: 'PROVIDER_RECONCILIATION',
        startedAt,
        completedAt: new Date(),
        success: false,
        details: { providerName },
        errors: [errorMessage]
      };
    }
  }

  /**
   * Run ledger verification for a tenant
   */
  async runLedgerVerification(tenantId: TenantId): Promise<ReconciliationJobResult> {
    const jobId = `ledger_ver_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting ledger verification job', {
      jobId,
      tenantId
    });

    try {
      const result = await this.reconciliationService.verifyLedgerBalances(tenantId);

      const errors = result.discrepancies.map(d => 
        `Account ${d.accountId}: stored=${d.storedBalance.toString()}, ` +
        `calculated=${d.calculatedBalance.toString()}, ` +
        `discrepancy=${d.discrepancy.toString()}`
      );

      return {
        jobId,
        tenantId,
        type: 'LEDGER_VERIFICATION',
        startedAt,
        completedAt: new Date(),
        success: result.invalid === 0,
        details: {
          accountsChecked: result.accountsChecked,
          valid: result.valid,
          invalid: result.invalid
        },
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Ledger verification job failed', {
        jobId,
        tenantId,
        error: errorMessage
      });

      return {
        jobId,
        tenantId,
        type: 'LEDGER_VERIFICATION',
        startedAt,
        completedAt: new Date(),
        success: false,
        details: {},
        errors: [errorMessage]
      };
    }
  }

  /**
   * Run bank reconciliation for an account
   */
  async runBankReconciliation(
    tenantId: TenantId,
    accountId: AccountId,
    bankTransactions: BankTransaction[],
    periodStart: Date,
    periodEnd: Date
  ): Promise<ReconciliationJobResult> {
    const jobId = `bank_rec_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting bank reconciliation job', {
      jobId,
      tenantId,
      accountId,
      transactionCount: bankTransactions.length
    });

    try {
      const result = await this.reconciliationService.reconcileBankTransactions(
        tenantId,
        accountId,
        bankTransactions,
        periodStart,
        periodEnd
      );

      const errors: string[] = [];
      
      if (result.unmatchedPayments.length > 0) {
        errors.push(
          `${result.unmatchedPayments.length} unmatched payments found`
        );
      }
      
      if (result.unmatchedBankTransactions.length > 0) {
        errors.push(
          `${result.unmatchedBankTransactions.length} unmatched bank transactions found`
        );
      }
      
      if (!result.discrepancy.isZero()) {
        errors.push(
          `Balance discrepancy: ${result.discrepancy.toString()}`
        );
      }

      return {
        jobId,
        tenantId,
        type: 'BANK_RECONCILIATION',
        startedAt,
        completedAt: new Date(),
        success: errors.length === 0,
        details: {
          reconciliationId: result.reconciliationId,
          accountId,
          periodStart,
          periodEnd,
          matchedCount: result.matchedItems.length,
          unmatchedPayments: result.unmatchedPayments.length,
          unmatchedBankTransactions: result.unmatchedBankTransactions.length,
          exceptionCount: result.exceptions.length,
          openingBalance: result.openingBalance.toString(),
          closingBalance: result.closingBalance.toString(),
          expectedBalance: result.expectedBalance.toString(),
          discrepancy: result.discrepancy.toString()
        },
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Bank reconciliation job failed', {
        jobId,
        tenantId,
        accountId,
        error: errorMessage
      });

      return {
        jobId,
        tenantId,
        type: 'BANK_RECONCILIATION',
        startedAt,
        completedAt: new Date(),
        success: false,
        details: { accountId },
        errors: [errorMessage]
      };
    }
  }

  /**
   * Get job configuration
   */
  getConfig(): ReconciliationJobConfig {
    return { ...this.config };
  }

  /**
   * Update job configuration
   */
  updateConfig(config: Partial<ReconciliationJobConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Job scheduler interface
 * Can be implemented with BullMQ, node-cron, etc.
 */
export interface IJobScheduler {
  /**
   * Schedule a recurring job
   */
  scheduleRecurring(
    name: string,
    cronExpression: string,
    handler: () => Promise<void>
  ): void;

  /**
   * Schedule a one-time job
   */
  scheduleOnce(
    name: string,
    runAt: Date,
    handler: () => Promise<void>
  ): void;

  /**
   * Cancel a scheduled job
   */
  cancel(name: string): void;

  /**
   * Get job status
   */
  getStatus(name: string): {
    scheduled: boolean;
    lastRun?: Date;
    nextRun?: Date;
  };
}
