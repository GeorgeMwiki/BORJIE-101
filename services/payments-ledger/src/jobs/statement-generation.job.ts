/**
 * Statement Generation Job
 * Background job for automated statement generation
 */
import {
  TenantId,
  OwnerId,
  CustomerId,
  StatementPeriodType
} from '@borjie/domain-models';
import {
  StatementGenerationService
} from '../services/statement-generation.service';
import { IAccountRepository } from '../repositories/account.repository';
import { ILogger } from '../services/payment-orchestration.service';

/**
 * Job configuration
 */
export interface StatementGenerationJobConfig {
  // Day of month to generate monthly statements (1-28)
  monthlyStatementDay: number;
  // Whether to auto-send generated statements
  autoSendStatements: boolean;
  // Maximum statements to generate per batch
  batchSize: number;
}

/**
 * Job result
 */
export interface StatementGenerationJobResult {
  jobId: string;
  tenantId: TenantId;
  type: 'OWNER_STATEMENTS' | 'CUSTOMER_STATEMENTS';
  period: {
    type: StatementPeriodType;
    year: number;
    month?: number;
    quarter?: number;
  };
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  generatedCount: number;
  failedCount: number;
  errors?: string[];
}

/**
 * Statement Generation Job
 * Handles scheduled statement generation tasks
 */
export class StatementGenerationJob {
  private statementService: StatementGenerationService;
  private accountRepository: IAccountRepository;
  private logger: ILogger;
  private config: StatementGenerationJobConfig;

  constructor(
    statementService: StatementGenerationService,
    accountRepository: IAccountRepository,
    logger: ILogger,
    config?: Partial<StatementGenerationJobConfig>
  ) {
    this.statementService = statementService;
    this.accountRepository = accountRepository;
    this.logger = logger;
    this.config = {
      monthlyStatementDay: 1,
      autoSendStatements: true,
      batchSize: 100,
      ...config
    };
  }

  /**
   * Generate monthly owner statements for all owners in a tenant
   */
  async generateOwnerMonthlyStatements(
    tenantId: TenantId,
    year: number,
    month: number
  ): Promise<StatementGenerationJobResult> {
    const jobId = `owner_stmt_${year}_${month}_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting owner monthly statement generation', {
      jobId,
      tenantId,
      year,
      month
    });

    // Get all owner operating accounts
    const accounts = await this.accountRepository.find({
      tenantId,
      type: 'OWNER_OPERATING',
      status: 'ACTIVE'
    });

    const ownerIds = accounts
      .filter(a => a.ownerId)
      .map(a => a.ownerId!);

    let generatedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const ownerId of ownerIds) {
      try {
        await this.statementService.generateOwnerMonthlyStatement(
          tenantId,
          ownerId,
          year,
          month
        );
        generatedCount++;
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Owner ${ownerId}: ${errorMessage}`);
        
        this.logger.warn('Failed to generate owner statement', {
          jobId,
          ownerId,
          error: errorMessage
        });
      }
    }

    this.logger.info('Owner monthly statement generation completed', {
      jobId,
      tenantId,
      generatedCount,
      failedCount
    });

    return {
      jobId,
      tenantId,
      type: 'OWNER_STATEMENTS',
      period: {
        type: 'MONTHLY',
        year,
        month
      },
      startedAt,
      completedAt: new Date(),
      success: failedCount === 0,
      generatedCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Generate monthly customer statements for all customers in a tenant
   */
  async generateCustomerMonthlyStatements(
    tenantId: TenantId,
    year: number,
    month: number
  ): Promise<StatementGenerationJobResult> {
    const jobId = `cust_stmt_${year}_${month}_${Date.now()}`;
    const startedAt = new Date();

    this.logger.info('Starting customer monthly statement generation', {
      jobId,
      tenantId,
      year,
      month
    });

    // Get all customer liability accounts
    const accounts = await this.accountRepository.find({
      tenantId,
      type: 'CUSTOMER_LIABILITY',
      status: 'ACTIVE'
    });

    const customerIds = accounts
      .filter(a => a.customerId)
      .map(a => a.customerId!);

    const { start: periodStart, end: periodEnd } = 
      StatementGenerationService.getMonthlyPeriod(year, month);

    let generatedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const customerId of customerIds) {
      try {
        await this.statementService.generateCustomerStatement(
          tenantId,
          customerId,
          periodStart,
          periodEnd
        );
        generatedCount++;
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Customer ${customerId}: ${errorMessage}`);
        
        this.logger.warn('Failed to generate customer statement', {
          jobId,
          customerId,
          error: errorMessage
        });
      }
    }

    this.logger.info('Customer monthly statement generation completed', {
      jobId,
      tenantId,
      generatedCount,
      failedCount
    });

    return {
      jobId,
      tenantId,
      type: 'CUSTOMER_STATEMENTS',
      period: {
        type: 'MONTHLY',
        year,
        month
      },
      startedAt,
      completedAt: new Date(),
      success: failedCount === 0,
      generatedCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Generate statements for the previous month
   * This is the typical scheduled job that runs on the 1st of each month
   */
  async generatePreviousMonthStatements(
    tenantId: TenantId
  ): Promise<{
    ownerStatements: StatementGenerationJobResult;
    customerStatements: StatementGenerationJobResult;
  }> {
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const [ownerStatements, customerStatements] = await Promise.all([
      this.generateOwnerMonthlyStatements(tenantId, year, prevMonth),
      this.generateCustomerMonthlyStatements(tenantId, year, prevMonth)
    ]);

    return { ownerStatements, customerStatements };
  }

  /**
   * Check if it's time to generate statements
   */
  shouldGenerateStatements(): boolean {
    const now = new Date();
    return now.getDate() === this.config.monthlyStatementDay;
  }

  /**
   * Get job configuration
   */
  getConfig(): StatementGenerationJobConfig {
    return { ...this.config };
  }

  /**
   * Update job configuration
   */
  updateConfig(config: Partial<StatementGenerationJobConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
