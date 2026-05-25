/**
 * Disbursement Service
 * Handles owner disbursements/payouts
 */
import { v4 as uuidv4 } from 'uuid';
import {
  Money,
  TenantId,
  OwnerId,
  AccountId,
  PropertyId,
  CurrencyCode,
  JournalTemplates
} from '@borjie/domain-models';
import { createId } from '../domain-extensions';
import { IPaymentProvider, TransferResult } from '../providers/payment-provider.interface';
import { IAccountRepository } from '../repositories/account.repository';
import { IDisbursementRepository, Disbursement, DisbursementStatus } from '../repositories/disbursement.repository';
import { IEventPublisher, createEvent } from '../events/event-publisher';
import {
  DisbursementInitiatedEvent,
  DisbursementCompletedEvent,
  DisbursementFailedEvent
} from '../events/payment-events';
import { LedgerService } from './ledger.service';
import { ILogger } from './payment-orchestration.service';

/**
 * Disbursement request
 */
export interface DisbursementRequest {
  tenantId: TenantId;
  ownerId: OwnerId;
  amount?: Money;  // If not specified, disburse full available balance
  destination: string;  // Bank account or connected account ID
  description?: string;
  idempotencyKey?: string;
}

/**
 * Disbursement result
 */
export interface DisbursementResult {
  disbursementId: string;
  ownerId: OwnerId;
  amount: Money;
  status: 'PENDING' | 'IN_TRANSIT' | 'PAID' | 'FAILED' | 'CANCELLED';
  transferId: string;
  estimatedArrival?: Date;
  failureReason?: string;
}

/**
 * Owner disbursement info
 */
export interface OwnerDisbursementInfo {
  ownerId: OwnerId;
  availableBalance: Money;
  pendingDisbursements: Money;
  lastDisbursementDate?: Date;
  nextScheduledDate?: Date;
}

export interface DisbursementServiceDeps {
  accountRepository: IAccountRepository;
  ledgerService: LedgerService;
  eventPublisher: IEventPublisher;
  logger: ILogger;
  disbursementRepository?: IDisbursementRepository;
}

/**
 * Disbursement Service
 * Manages automated and manual disbursements to property owners
 */
export class DisbursementService {
  private providers: Map<string, IPaymentProvider> = new Map();
  private defaultProvider: string | null = null;
  
  private accountRepository: IAccountRepository;
  private disbursementRepository: IDisbursementRepository | null;
  private ledgerService: LedgerService;
  private eventPublisher: IEventPublisher;
  private logger: ILogger;

  constructor(deps: DisbursementServiceDeps) {
    this.accountRepository = deps.accountRepository;
    this.disbursementRepository = deps.disbursementRepository || null;
    this.ledgerService = deps.ledgerService;
    this.eventPublisher = deps.eventPublisher;
    this.logger = deps.logger;
  }

  /**
   * Register payment provider for disbursements
   */
  registerProvider(provider: IPaymentProvider, isDefault: boolean = false): void {
    this.providers.set(provider.name, provider);
    if (isDefault) {
      this.defaultProvider = provider.name;
    }
  }

  /**
   * Process a disbursement to an owner
   */
  async processDisbursement(request: DisbursementRequest): Promise<DisbursementResult> {
    const disbursementId = uuidv4();
    const idempotencyKey = request.idempotencyKey || disbursementId;

    this.logger.info('Processing disbursement', {
      disbursementId,
      tenantId: request.tenantId,
      ownerId: request.ownerId
    });

    // Get owner's accounts
    const operatingAccount = await this.accountRepository.findByOwnerAndType(
      request.tenantId,
      request.ownerId,
      'OWNER_OPERATING'
    );
    if (!operatingAccount) {
      throw new Error(`Owner operating account not found for owner ${request.ownerId}`);
    }

    const platformHoldingAccount = await this.accountRepository.findPlatformAccounts(
      request.tenantId,
      'PLATFORM_HOLDING'
    );
    if (!platformHoldingAccount) {
      throw new Error('Platform holding account not found');
    }

    // Determine disbursement amount
    const availableBalance = Money.fromMinorUnits(
      platformHoldingAccount.balanceMinorUnits,
      platformHoldingAccount.currency
    );

    const amount = request.amount || availableBalance;

    if (amount.isGreaterThan(availableBalance)) {
      throw new Error(
        `Insufficient balance for disbursement. ` +
        `Available: ${availableBalance.toString()}, Requested: ${amount.toString()}`
      );
    }

    if (amount.isZero() || amount.isNegative()) {
      throw new Error('Disbursement amount must be positive');
    }

    // Get payment provider
    const provider = this.getProvider();
    const now = new Date();

    // Create disbursement record for persistence
    const disbursementRecord: Disbursement = {
      id: disbursementId,
      tenantId: request.tenantId,
      ownerId: request.ownerId,
      amountMinorUnits: amount.amountMinorUnits,
      currency: amount.currency,
      status: 'PENDING',
      destination: request.destination,
      destinationType: 'BANK_ACCOUNT',
      description: request.description,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system'
    };

    // Persist disbursement record
    if (this.disbursementRepository) {
      await this.disbursementRepository.create(disbursementRecord);
    }

    try {
      // Create transfer with provider
      const transferResult = await provider.createTransfer({
        amount,
        destination: request.destination,
        description: request.description || `Disbursement to owner ${request.ownerId}`,
        metadata: {
          tenantId: request.tenantId,
          ownerId: request.ownerId,
          disbursementId
        },
        idempotencyKey
      });

      // Record in ledger
      await this.ledgerService.postJournalEntry(
        JournalTemplates.ownerDisbursement(
          request.tenantId,
          platformHoldingAccount.id,
          operatingAccount.id,
          amount,
          'system'
        )
      );

      // Update disbursement record with transfer details
      const updatedStatus: DisbursementStatus = transferResult.status === 'PAID'
        ? 'PAID'
        : transferResult.status === 'IN_TRANSIT'
          ? 'IN_TRANSIT'
          : 'PROCESSING';

      if (this.disbursementRepository) {
        await this.disbursementRepository.update({
          ...disbursementRecord,
          status: updatedStatus,
          provider: provider.name,
          transferId: transferResult.transferId,
          initiatedAt: now,
          completedAt: transferResult.status === 'PAID' ? new Date() : undefined,
          estimatedArrival: transferResult.arrivalDate,
          updatedAt: new Date(),
          updatedBy: 'system'
        });
      }

      // Publish event
      await this.eventPublisher.publish(
        createEvent<DisbursementInitiatedEvent>(
          'DISBURSEMENT_INITIATED',
          'Disbursement',
          disbursementId,
          request.tenantId,
          {
            ownerId: request.ownerId,
            amount: amount.toData(),
            destination: request.destination,
            transferId: transferResult.transferId
          }
        )
      );

      // If transfer is complete, publish completion event
      if (transferResult.status === 'PAID') {
        await this.eventPublisher.publish(
          createEvent<DisbursementCompletedEvent>(
            'DISBURSEMENT_COMPLETED',
            'Disbursement',
            disbursementId,
            request.tenantId,
            {
              ownerId: request.ownerId,
              amount: amount.toData(),
              completedAt: new Date()
            }
          )
        );
      }

      this.logger.info('Disbursement processed', {
        disbursementId,
        ownerId: request.ownerId,
        amount: amount.toString(),
        status: transferResult.status
      });

      return {
        disbursementId,
        ownerId: request.ownerId,
        amount,
        status: transferResult.status,
        transferId: transferResult.transferId,
        estimatedArrival: transferResult.arrivalDate
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update disbursement record as failed
      if (this.disbursementRepository) {
        await this.disbursementRepository.update({
          ...disbursementRecord,
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: errorMessage,
          updatedAt: new Date(),
          updatedBy: 'system'
        });
      }

      await this.eventPublisher.publish(
        createEvent<DisbursementFailedEvent>(
          'DISBURSEMENT_FAILED',
          'Disbursement',
          disbursementId,
          request.tenantId,
          {
            ownerId: request.ownerId,
            amount: amount.toData(),
            failureReason: errorMessage
          }
        )
      );

      this.logger.error('Disbursement failed', {
        disbursementId,
        ownerId: request.ownerId,
        error: errorMessage
      });

      return {
        disbursementId,
        ownerId: request.ownerId,
        amount,
        status: 'FAILED',
        transferId: '',
        failureReason: errorMessage
      };
    }
  }

  /**
   * Get disbursement info for an owner
   */
  async getOwnerDisbursementInfo(
    tenantId: TenantId,
    ownerId: OwnerId
  ): Promise<OwnerDisbursementInfo> {
    const operatingAccount = await this.accountRepository.findByOwnerAndType(
      tenantId,
      ownerId,
      'OWNER_OPERATING'
    );

    if (!operatingAccount) {
      throw new Error(`Owner operating account not found for owner ${ownerId}`);
    }

    const availableBalance = Money.fromMinorUnits(
      operatingAccount.balanceMinorUnits,
      operatingAccount.currency
    );

    return {
      ownerId,
      availableBalance,
      pendingDisbursements: Money.zero(operatingAccount.currency),
      lastDisbursementDate: operatingAccount.lastEntryAt
    };
  }

  /**
   * Get owners eligible for disbursement
   */
  async getEligibleOwners(
    tenantId: TenantId,
    minBalance: number = 1000  // Minimum balance in minor units
  ): Promise<Array<{ ownerId: OwnerId; balance: Money }>> {
    const accounts = await this.accountRepository.findWithPositiveBalance(
      tenantId,
      'OWNER_OPERATING',
      minBalance
    );

    return accounts
      .filter(a => a.ownerId)
      .map(a => ({
        ownerId: a.ownerId!,
        balance: Money.fromMinorUnits(a.balanceMinorUnits, a.currency)
      }));
  }

  /**
   * Process scheduled disbursements for all eligible owners
   */
  async processScheduledDisbursements(
    tenantId: TenantId,
    minBalance: number = 1000
  ): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    results: DisbursementResult[];
  }> {
    const eligibleOwners = await this.getEligibleOwners(tenantId, minBalance);
    
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const results: DisbursementResult[] = [];

    for (const owner of eligibleOwners) {
      processed++;
      
      try {
        // Get owner's connected account (would come from owner profile in real impl)
        const destination = `acct_${owner.ownerId}`; // Placeholder
        
        const result = await this.processDisbursement({
          tenantId,
          ownerId: owner.ownerId,
          destination
        });

        results.push(result);
        
        if (result.status !== 'FAILED') {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        this.logger.error('Scheduled disbursement failed', {
          ownerId: owner.ownerId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.logger.info('Scheduled disbursements processed', {
      tenantId,
      processed,
      succeeded,
      failed
    });

    return { processed, succeeded, failed, results };
  }

  /**
   * Get a disbursement by ID
   */
  async getDisbursement(
    disbursementId: string,
    tenantId: TenantId
  ): Promise<Disbursement | null> {
    if (!this.disbursementRepository) {
      throw new Error('Disbursement repository not configured');
    }
    return this.disbursementRepository.findById(disbursementId, tenantId);
  }

  /**
   * List disbursements with optional filters
   */
  async listDisbursements(
    tenantId: TenantId,
    filters?: {
      ownerId?: OwnerId;
      status?: DisbursementStatus | DisbursementStatus[];
      fromDate?: Date;
      toDate?: Date;
    },
    page: number = 1,
    pageSize: number = 20
  ) {
    if (!this.disbursementRepository) {
      throw new Error('Disbursement repository not configured');
    }
    return this.disbursementRepository.find(
      {
        tenantId,
        ownerId: filters?.ownerId,
        status: filters?.status,
        fromDate: filters?.fromDate,
        toDate: filters?.toDate
      },
      page,
      pageSize
    );
  }

  /**
   * Get disbursements for a specific owner
   */
  async getOwnerDisbursements(
    tenantId: TenantId,
    ownerId: OwnerId,
    page: number = 1,
    pageSize: number = 20
  ) {
    if (!this.disbursementRepository) {
      throw new Error('Disbursement repository not configured');
    }
    return this.disbursementRepository.findByOwner(tenantId, ownerId, page, pageSize);
  }

  /**
   * Get provider for disbursements
   */
  private getProvider(): IPaymentProvider {
    if (!this.defaultProvider) {
      throw new Error('No payment provider configured for disbursements');
    }
    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Payment provider ${this.defaultProvider} not found`);
    }
    return provider;
  }

  // ==========================================================================
  // Disbursement Calculation Helpers
  // ==========================================================================

  /**
   * Calculate disbursement breakdown for an owner
   * Shows gross income, fees, deductions, and net payout
   */
  async calculateDisbursementBreakdown(
    tenantId: TenantId,
    ownerId: OwnerId,
    periodStart?: Date,
    periodEnd?: Date
  ): Promise<DisbursementBreakdown> {
    // Get owner's operating account
    const operatingAccount = await this.accountRepository.findByOwnerAndType(
      tenantId,
      ownerId,
      'OWNER_OPERATING'
    );

    if (!operatingAccount) {
      throw new Error(`Owner operating account not found for owner ${ownerId}`);
    }

    const currency = operatingAccount.currency;
    const availableBalance = Money.fromMinorUnits(
      operatingAccount.balanceMinorUnits,
      currency
    );

    // Default period to current month if not specified. Use UTC — local
    // date construction shifts the period boundary for non-UTC servers
    // and silently pulls/pushes entries across the month line.
    const now = new Date();
    const fromDate =
      periodStart ||
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const toDate =
      periodEnd ||
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    // Get ledger entries for the period to calculate breakdown
    const statement = await this.ledgerService.getStatement(
      operatingAccount.id,
      tenantId,
      fromDate,
      toDate
    );

    // Calculate breakdown from entries
    let grossRentMinor = 0;
    let platformFeesMinor = 0;
    let processingFeesMinor = 0;
    let maintenanceMinor = 0;
    let otherDeductionsMinor = 0;
    const items: DisbursementBreakdownItem[] = [];

    for (const entry of statement.entries) {
      if (entry.direction === 'DEBIT') {
        // Income items
        if (entry.type === 'RENT_PAYMENT') {
          grossRentMinor += entry.amount.amountMinorUnits;
          items.push({
            type: 'RENT_INCOME',
            description: entry.description || 'Rent Payment',
            amount: entry.amount,
            propertyId: entry.propertyId,
            unitId: entry.unitId,
          });
        } else if (entry.type === 'DEPOSIT_PAYMENT') {
          items.push({
            type: 'DEPOSIT_INCOME',
            description: entry.description || 'Deposit Payment',
            amount: entry.amount,
            propertyId: entry.propertyId,
            unitId: entry.unitId,
          });
        }
      } else {
        // Deduction items
        if (entry.type === 'PLATFORM_FEE') {
          platformFeesMinor += entry.amount.amountMinorUnits;
          items.push({
            type: 'PLATFORM_FEE',
            description: entry.description || 'Platform Fee',
            amount: Money.fromMinorUnits(-entry.amount.amountMinorUnits, currency),
            propertyId: entry.propertyId,
          });
        } else if ((entry.type as string) === 'PAYMENT_PROCESSING_FEE') {
          processingFeesMinor += entry.amount.amountMinorUnits;
          items.push({
            type: 'PROCESSING_FEE',
            description: entry.description || 'Processing Fee',
            amount: Money.fromMinorUnits(-entry.amount.amountMinorUnits, currency),
            propertyId: entry.propertyId,
          });
        } else if ((entry.type as string) === 'MAINTENANCE_CHARGE') {
          maintenanceMinor += entry.amount.amountMinorUnits;
          items.push({
            type: 'MAINTENANCE',
            description: entry.description || 'Maintenance Charge',
            amount: Money.fromMinorUnits(-entry.amount.amountMinorUnits, currency),
            propertyId: entry.propertyId,
            unitId: entry.unitId,
          });
        } else if (entry.type === 'OWNER_DISBURSEMENT') {
          // Skip - this is a previous disbursement
        } else {
          otherDeductionsMinor += entry.amount.amountMinorUnits;
          items.push({
            type: 'OTHER_DEDUCTION',
            description: entry.description || entry.type,
            amount: Money.fromMinorUnits(-entry.amount.amountMinorUnits, currency),
            propertyId: entry.propertyId,
          });
        }
      }
    }

    // Calculate holdback (reserve for future expenses, typically 10-20%)
    const holdbackPercent = 0; // Can be configured per owner
    const holdbackMinor = Math.round(grossRentMinor * holdbackPercent / 100);

    const netAmountMinor = grossRentMinor - platformFeesMinor - processingFeesMinor -
      maintenanceMinor - otherDeductionsMinor - holdbackMinor;

    return {
      grossAmount: Money.fromMinorUnits(grossRentMinor, currency),
      platformFee: Money.fromMinorUnits(platformFeesMinor, currency),
      processingFee: Money.fromMinorUnits(processingFeesMinor, currency),
      holdbackAmount: Money.fromMinorUnits(holdbackMinor, currency),
      netAmount: Money.fromMinorUnits(Math.max(0, netAmountMinor), currency),
      items,
    };
  }

  /**
   * Calculate platform fees for a given gross amount
   */
  calculatePlatformFee(grossAmount: Money, feePercent: number): Money {
    const feeMinorUnits = Math.round(grossAmount.amountMinorUnits * feePercent / 100);
    return Money.fromMinorUnits(feeMinorUnits, grossAmount.currency);
  }

  /**
   * Calculate net amount after fees
   */
  calculateNetAmount(
    grossAmount: Money,
    platformFeePercent: number,
    processingFeePercent: number = 0
  ): {
    gross: Money;
    platformFee: Money;
    processingFee: Money;
    net: Money;
  } {
    const platformFee = this.calculatePlatformFee(grossAmount, platformFeePercent);
    const processingFee = this.calculatePlatformFee(grossAmount, processingFeePercent);
    const netMinor = grossAmount.amountMinorUnits - platformFee.amountMinorUnits - processingFee.amountMinorUnits;

    return {
      gross: grossAmount,
      platformFee,
      processingFee,
      net: Money.fromMinorUnits(Math.max(0, netMinor), grossAmount.currency),
    };
  }

  /**
   * Preview a disbursement without processing it
   */
  async previewDisbursement(
    tenantId: TenantId,
    ownerId: OwnerId,
    amount?: Money
  ): Promise<{
    ownerId: OwnerId;
    availableBalance: Money;
    requestedAmount: Money;
    breakdown: DisbursementBreakdown;
    estimatedArrival: Date;
    warnings: string[];
  }> {
    const breakdown = await this.calculateDisbursementBreakdown(tenantId, ownerId);
    const warnings: string[] = [];

    // Get available balance
    const operatingAccount = await this.accountRepository.findByOwnerAndType(
      tenantId,
      ownerId,
      'OWNER_OPERATING'
    );

    if (!operatingAccount) {
      throw new Error(`Owner operating account not found for owner ${ownerId}`);
    }

    const availableBalance = Money.fromMinorUnits(
      operatingAccount.balanceMinorUnits,
      operatingAccount.currency
    );

    const requestedAmount = amount || availableBalance;

    // Validation warnings
    if (requestedAmount.isGreaterThan(availableBalance)) {
      warnings.push(`Requested amount exceeds available balance of ${availableBalance.toString()}`);
    }

    if (requestedAmount.amountMinorUnits < 1000) {
      warnings.push('Minimum disbursement amount is typically 10.00');
    }

    // Estimate arrival (typically 2-3 business days)
    const estimatedArrival = this.calculateEstimatedArrival();

    return {
      ownerId,
      availableBalance,
      requestedAmount,
      breakdown,
      estimatedArrival,
      warnings,
    };
  }

  /**
   * Get disbursement summary for all owners in a tenant
   */
  async getDisbursementSummary(
    tenantId: TenantId,
    minBalance: number = 1000,
    /**
     * Currency to report when no eligible owners exist. Caller supplies
     * this from tenant region-config; required so an empty-portfolio
     * summary never reports KES for a non-Kenya tenant.
     */
    fallbackCurrency?: string
  ): Promise<{
    totalEligibleOwners: number;
    totalDisbursableAmount: Money;
    owners: Array<{
      ownerId: OwnerId;
      availableBalance: Money;
      lastDisbursementDate?: Date;
    }>;
  }> {
    const eligibleOwners = await this.getEligibleOwners(tenantId, minBalance);

    if (eligibleOwners.length === 0) {
      if (!fallbackCurrency) {
        throw new Error(
          'disbursement: fallbackCurrency is required when there are no eligible owners.'
        );
      }
      return {
        totalEligibleOwners: 0,
        // Money.zero's parameter is typed to the platform's CurrencyCode
        // union; fallbackCurrency has already been validated as a non-
        // empty ISO-4217 code upstream (via region-config), so we cast
        // to satisfy the generated union type.
        totalDisbursableAmount: Money.zero(fallbackCurrency as never),
        owners: [],
      };
    }

    let totalMinor = 0;
    const currency = eligibleOwners[0].balance.currency;

    for (const owner of eligibleOwners) {
      totalMinor += owner.balance.amountMinorUnits;
    }

    return {
      totalEligibleOwners: eligibleOwners.length,
      totalDisbursableAmount: Money.fromMinorUnits(totalMinor, currency),
      owners: eligibleOwners.map(o => ({
        ownerId: o.ownerId,
        availableBalance: o.balance,
      })),
    };
  }

  /**
   * Calculate estimated arrival date for disbursement
   */
  private calculateEstimatedArrival(businessDays: number = 3): Date {
    const arrival = new Date();
    let daysAdded = 0;

    while (daysAdded < businessDays) {
      arrival.setDate(arrival.getDate() + 1);
      const dayOfWeek = arrival.getDay();
      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        daysAdded++;
      }
    }

    return arrival;
  }
}

/**
 * Disbursement breakdown for calculations
 */
export interface DisbursementBreakdown {
  grossAmount: Money;
  platformFee: Money;
  processingFee: Money;
  holdbackAmount: Money;
  netAmount: Money;
  items: DisbursementBreakdownItem[];
}

export interface DisbursementBreakdownItem {
  type: string;
  description: string;
  amount: Money;
  propertyId?: PropertyId;
  unitId?: string;
}
