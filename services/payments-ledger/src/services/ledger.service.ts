/**
 * Ledger Service
 * Manages the immutable double-entry ledger
 */
import { v4 as uuidv4 } from 'uuid';
import {
  Money,
  LedgerEntry,
  LedgerEntryId,
  AccountId,
  TenantId,
  Account,
  AccountAggregate,
  CreateJournalEntryRequest,
  JournalEntryLine,
  validateJournalBalance,
  createJournalId,
  CurrencyCode
} from '@borjie/domain-models';
import { createId } from '../domain-extensions';
import { ILedgerRepository, AccountBalance } from '../repositories/ledger.repository';
import { IAccountRepository } from '../repositories/account.repository';
import { IEventPublisher, createEvent } from '../events/event-publisher';
import {
  LedgerEntriesCreatedEvent,
  AccountBalanceUpdatedEvent
} from '../events/payment-events';
import { ILogger } from './payment-orchestration.service';
import { omitUndefined } from '../lib/omit-undefined';

export interface LedgerServiceDeps {
  ledgerRepository: ILedgerRepository;
  accountRepository: IAccountRepository;
  eventPublisher: IEventPublisher;
  logger: ILogger;
}

/**
 * Result of posting a journal entry
 */
export interface JournalPostResult {
  journalId: string;
  entries: LedgerEntry[];
  updatedAccounts: Account[];
}

/**
 * Ledger Service
 * Provides atomic, double-entry bookkeeping operations
 */
export class LedgerService {
  private ledgerRepository: ILedgerRepository;
  private accountRepository: IAccountRepository;
  private eventPublisher: IEventPublisher;
  private logger: ILogger;

  constructor(deps: LedgerServiceDeps) {
    this.ledgerRepository = deps.ledgerRepository;
    this.accountRepository = deps.accountRepository;
    this.eventPublisher = deps.eventPublisher;
    this.logger = deps.logger;
  }

  /**
   * Post a journal entry (atomic double-entry operation)
   */
  async postJournalEntry(request: CreateJournalEntryRequest): Promise<JournalPostResult> {
    // Validate that the journal is balanced
    if (!validateJournalBalance(request.lines)) {
      throw new Error('Journal entry is not balanced: debits must equal credits');
    }

    if (request.lines.length === 0) {
      throw new Error('Journal entry must have at least one line');
    }

    const journalId = createJournalId();
    const now = new Date();
    const entries: LedgerEntry[] = [];
    const accountUpdates: Map<AccountId, { account: Account; newBalance: Money; entryId: LedgerEntryId }> = new Map();

    // Process each line
    for (const line of request.lines) {
      // Get account
      const account = await this.accountRepository.findById(line.accountId, request.tenantId);
      if (!account) {
        throw new Error(`Account ${line.accountId} not found`);
      }

      const accountAggregate = new AccountAggregate(account);
      if (!accountAggregate.canTransact()) {
        throw new Error(`Account ${line.accountId} is not active`);
      }

      // Currency check
      if (line.amount.currency !== account.currency) {
        throw new Error(
          `Currency mismatch: account ${line.accountId} is ${account.currency}, ` +
          `but entry is ${line.amount.currency}`
        );
      }

      // Get next sequence number
      const sequenceNumber = await this.ledgerRepository.getNextSequenceNumber(
        line.accountId,
        request.tenantId
      );

      // Calculate new balance
      const currentBalance = Money.fromMinorUnits(account.balanceMinorUnits, account.currency);
      let newBalance: Money;
      if (line.direction === 'DEBIT') {
        newBalance = currentBalance.add(line.amount);
      } else {
        newBalance = currentBalance.subtract(line.amount);
      }

      // Create ledger entry
      const entryId = createId<LedgerEntryId>(`le_${uuidv4()}`);
      const entry: LedgerEntry = omitUndefined({
        id: entryId,
        tenantId: request.tenantId,
        accountId: line.accountId,
        journalId,
        type: line.type,
        direction: line.direction,
        amount: line.amount,
        balanceAfter: newBalance,
        sequenceNumber,
        effectiveDate: request.effectiveDate,
        postedAt: now,
        paymentIntentId: request.paymentIntentId,
        leaseId: line.leaseId,
        propertyId: line.propertyId,
        unitId: line.unitId,
        description: line.description,
        metadata: line.metadata,
        createdAt: now,
        createdBy: request.createdBy,
        updatedAt: now,
        updatedBy: request.createdBy
      }) as LedgerEntry;

      entries.push(entry);
      accountUpdates.set(line.accountId, {
        account,
        newBalance,
        entryId
      });
    }

    // Persist entries atomically
    const savedEntries = await this.ledgerRepository.createEntries(entries);

    // Update account balances
    const updatedAccounts: Account[] = [];
    for (const [accountId, update] of accountUpdates) {
      const accountAggregate = new AccountAggregate(update.account);
      accountAggregate.updateBalance(update.newBalance, update.entryId);
      const updatedAccount = accountAggregate.toData();
      await this.accountRepository.update(updatedAccount);
      updatedAccounts.push(updatedAccount);

      // Publish balance update event
      await this.eventPublisher.publish(
        createEvent<AccountBalanceUpdatedEvent>(
          'ACCOUNT_BALANCE_UPDATED',
          'Account',
          accountId,
          request.tenantId,
          {
            previousBalance: Money.fromMinorUnits(
              update.account.balanceMinorUnits,
              update.account.currency
            ).toData(),
            newBalance: update.newBalance.toData(),
            lastEntryId: update.entryId
          }
        )
      );
    }

    // Publish journal entries created event
    await this.eventPublisher.publish(
      createEvent<LedgerEntriesCreatedEvent>(
        'LEDGER_ENTRIES_CREATED',
        'Ledger',
        journalId,
        request.tenantId,
        omitUndefined({
          journalId,
          entries: savedEntries.map(e => ({
            entryId: e.id,
            accountId: e.accountId,
            type: e.type,
            direction: e.direction,
            amount: e.amount.toData()
          })),
          paymentIntentId: request.paymentIntentId
        }) as LedgerEntriesCreatedEvent['payload']
      )
    );

    this.logger.info('Journal entry posted', {
      journalId,
      tenantId: request.tenantId,
      entryCount: savedEntries.length
    });

    return {
      journalId,
      entries: savedEntries,
      updatedAccounts
    };
  }

  /**
   * Get account balance
   */
  async getAccountBalance(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<Money | null> {
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      return null;
    }
    return Money.fromMinorUnits(account.balanceMinorUnits, account.currency);
  }

  /**
   * Get account balance at a specific date (calculated from entries)
   */
  async getAccountBalanceAsOf(
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate: Date
  ): Promise<AccountBalance | null> {
    return this.ledgerRepository.calculateAccountBalance(accountId, tenantId, asOfDate);
  }

  /**
   * Get ledger entries for an account
   */
  async getAccountEntries(
    accountId: AccountId,
    tenantId: TenantId,
    page?: number,
    pageSize?: number
  ) {
    return this.ledgerRepository.findByAccount(accountId, tenantId, page, pageSize);
  }

  /**
   * Get entries by journal ID
   */
  async getJournalEntries(journalId: string, tenantId: TenantId): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findByJournalId(journalId, tenantId);
  }

  /**
   * Verify ledger integrity for an account
   */
  async verifyAccountIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<{ valid: boolean; calculatedBalance: Money | null; storedBalance: Money | null; discrepancy: Money | null }> {
    // Get stored balance
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      return { valid: false, calculatedBalance: null, storedBalance: null, discrepancy: null };
    }
    const storedBalance = Money.fromMinorUnits(account.balanceMinorUnits, account.currency);

    // Calculate balance from entries
    const calculatedResult = await this.ledgerRepository.calculateAccountBalance(accountId, tenantId);
    if (!calculatedResult) {
      // No entries - balance should be zero
      const valid = storedBalance.isZero();
      return {
        valid,
        calculatedBalance: Money.zero(account.currency),
        storedBalance,
        discrepancy: valid ? null : storedBalance
      };
    }

    const calculatedBalance = Money.fromMinorUnits(calculatedResult.balance, account.currency);
    const valid = calculatedBalance.equals(storedBalance);

    return {
      valid,
      calculatedBalance,
      storedBalance,
      discrepancy: valid ? null : storedBalance.subtract(calculatedBalance)
    };
  }

  /**
   * Verify sequence integrity (no gaps or duplicates)
   */
  async verifySequenceIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ) {
    return this.ledgerRepository.verifyIntegrity(accountId, tenantId);
  }

  /**
   * Get entries for statement generation
   */
  async getEntriesForStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findForStatement(accountId, tenantId, fromDate, toDate);
  }

  /**
   * Get totals by entry type for a period
   */
  async getTotalsByType(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ) {
    return this.ledgerRepository.getTotalsByType(accountId, tenantId, fromDate, toDate);
  }

  /**
   * Get account statement for a period
   * Returns a structured statement with opening/closing balances and all entries
   */
  async getStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<{
    accountId: AccountId;
    periodStart: Date;
    periodEnd: Date;
    openingBalance: Money;
    closingBalance: Money;
    totalDebits: Money;
    totalCredits: Money;
    entries: LedgerEntry[];
    currency: CurrencyCode;
  }> {
    // Get account for currency
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Calculate opening balance (balance as of instant before period start).
    // Use UTC arithmetic — getDate/setHours depend on the server's local
    // timezone and silently shift the boundary when not at UTC. The
    // "1 ms before fromDate" instant is timezone-invariant.
    const openingBalanceDate = new Date(fromDate.getTime() - 1);

    const openingBalanceResult = await this.ledgerRepository.calculateAccountBalance(
      accountId,
      tenantId,
      openingBalanceDate
    );
    const openingBalance = openingBalanceResult
      ? Money.fromMinorUnits(openingBalanceResult.balance, account.currency)
      : Money.zero(account.currency);

    // Get entries for the period
    const entries = await this.ledgerRepository.findForStatement(
      accountId,
      tenantId,
      fromDate,
      toDate
    );

    // Calculate totals
    let totalDebitsMinor = 0;
    let totalCreditsMinor = 0;

    for (const entry of entries) {
      if (entry.direction === 'DEBIT') {
        totalDebitsMinor += entry.amount.amountMinorUnits;
      } else {
        totalCreditsMinor += entry.amount.amountMinorUnits;
      }
    }

    // Calculate closing balance
    const closingBalance = openingBalance
      .add(Money.fromMinorUnits(totalDebitsMinor, account.currency))
      .subtract(Money.fromMinorUnits(totalCreditsMinor, account.currency));

    return {
      accountId,
      periodStart: fromDate,
      periodEnd: toDate,
      openingBalance,
      closingBalance,
      totalDebits: Money.fromMinorUnits(totalDebitsMinor, account.currency),
      totalCredits: Money.fromMinorUnits(totalCreditsMinor, account.currency),
      entries,
      currency: account.currency,
    };
  }

  /**
   * Post a correction entry (immutable - reverses original and creates new entry)
   * This maintains the immutability principle by never modifying existing entries
   */
  async postCorrectionEntry(
    originalEntryId: LedgerEntryId,
    tenantId: TenantId,
    correctionReason: string,
    correctedAmount: Money,
    createdBy: string
  ): Promise<JournalPostResult> {
    // Get original entry
    const originalEntry = await this.ledgerRepository.findById(originalEntryId, tenantId);
    if (!originalEntry) {
      throw new Error(`Original entry ${originalEntryId} not found`);
    }

    // Validate currencies match
    if (correctedAmount.currency !== originalEntry.amount.currency) {
      throw new Error(
        `Currency mismatch: original is ${originalEntry.amount.currency}, correction is ${correctedAmount.currency}`
      );
    }

    const now = new Date();
    const journalId = createJournalId();

    // Create reversal entry (opposite direction of original)
    const reversalDirection = originalEntry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';

    // Create correcting entry (same direction as original with corrected amount)
    const correctionEntries: CreateJournalEntryRequest = omitUndefined({
      tenantId,
      effectiveDate: now,
      lines: [
        // Reversal of original
        omitUndefined({
          accountId: originalEntry.accountId,
          // CORRECTION isn't in @borjie/domain-models' narrower
          // LedgerEntryType union (only the canonical trial-balance
          // categories are there). The local LedgerEntryType (./types.ts)
          // extends it with CORRECTION for void/correction semantics —
          // cast through the narrower union to bridge until the domain
          // type is widened upstream.
          type: 'CORRECTION' as unknown as JournalEntryLine['type'],
          direction: reversalDirection,
          amount: originalEntry.amount,
          description: `Reversal: ${correctionReason}`,
          leaseId: originalEntry.leaseId,
          propertyId: originalEntry.propertyId,
          unitId: originalEntry.unitId,
          metadata: { originalEntryId, correctionType: 'REVERSAL' },
        }) as JournalEntryLine,
        // New corrected entry
        omitUndefined({
          accountId: originalEntry.accountId,
          type: originalEntry.type,
          direction: originalEntry.direction,
          amount: correctedAmount,
          description: `Correction: ${correctionReason}`,
          leaseId: originalEntry.leaseId,
          propertyId: originalEntry.propertyId,
          unitId: originalEntry.unitId,
          metadata: { originalEntryId, correctionType: 'CORRECTED' },
        }) as JournalEntryLine,
      ],
      paymentIntentId: originalEntry.paymentIntentId,
      createdBy,
    }) as CreateJournalEntryRequest;

    this.logger.info('Posting correction entry', {
      originalEntryId,
      tenantId,
      originalAmount: originalEntry.amount.toString(),
      correctedAmount: correctedAmount.toString(),
      reason: correctionReason,
    });

    return this.postJournalEntry(correctionEntries);
  }

  /**
   * Void an entry by posting a full reversal
   * This maintains immutability - the original entry remains, a reversal is added
   */
  async voidEntry(
    entryId: LedgerEntryId,
    tenantId: TenantId,
    voidReason: string,
    createdBy: string
  ): Promise<JournalPostResult> {
    const entry = await this.ledgerRepository.findById(entryId, tenantId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const reversalDirection = entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';

    const voidRequest: CreateJournalEntryRequest = {
      tenantId,
      effectiveDate: new Date(),
      lines: [
        omitUndefined({
          accountId: entry.accountId,
          // CORRECTION isn't in @borjie/domain-models' narrower
          // LedgerEntryType union (only the canonical trial-balance
          // categories are there). The local LedgerEntryType (./types.ts)
          // extends it with CORRECTION for void/correction semantics —
          // cast through the narrower union to bridge until the domain
          // type is widened upstream.
          type: 'CORRECTION' as unknown as JournalEntryLine['type'],
          direction: reversalDirection,
          amount: entry.amount,
          description: `Void: ${voidReason}`,
          leaseId: entry.leaseId,
          propertyId: entry.propertyId,
          unitId: entry.unitId,
          metadata: { voidedEntryId: entryId, voidReason },
        }) as JournalEntryLine,
      ],
      createdBy,
    };

    this.logger.info('Voiding ledger entry', {
      entryId,
      tenantId,
      amount: entry.amount.toString(),
      reason: voidReason,
    });

    return this.postJournalEntry(voidRequest);
  }

  /**
   * Get running balance history for an account
   */
  async getBalanceHistory(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<Array<{ date: Date; balance: Money; entryId: LedgerEntryId }>> {
    const entries = await this.ledgerRepository.findForStatement(
      accountId,
      tenantId,
      fromDate,
      toDate
    );

    return entries.map(entry => ({
      date: entry.effectiveDate,
      balance: entry.balanceAfter,
      entryId: entry.id,
    }));
  }
}
