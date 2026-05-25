/**
 * Payment Domain Events
 * Events emitted by the payments and ledger services
 */
import {
  PaymentIntentId,
  TenantId,
  CustomerId,
  OwnerId,
  LeaseId,
  AccountId,
  StatementId,
  LedgerEntryId
} from '@borjie/domain-models';
import { MoneyData } from '../domain-extensions';

/**
 * Base event interface
 */
export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: TenantId;
  timestamp: Date;
  version: number;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Payment Intent Events
 */
export interface PaymentIntentCreatedEvent extends DomainEvent {
  eventType: 'PAYMENT_INTENT_CREATED';
  aggregateType: 'PaymentIntent';
  payload: {
    customerId: CustomerId;
    leaseId?: LeaseId;
    amount: MoneyData;
    type: string;
    description: string;
  };
}

export interface PaymentProcessingStartedEvent extends DomainEvent {
  eventType: 'PAYMENT_PROCESSING_STARTED';
  aggregateType: 'PaymentIntent';
  payload: {
    externalId: string;
    providerName: string;
  };
}

export interface PaymentSucceededEvent extends DomainEvent {
  eventType: 'PAYMENT_SUCCEEDED';
  aggregateType: 'PaymentIntent';
  payload: {
    customerId: CustomerId;
    leaseId?: LeaseId;
    amount: MoneyData;
    platformFee?: MoneyData;
    netAmount?: MoneyData;
    paidAt: Date;
    receiptUrl?: string;
  };
}

export interface PaymentFailedEvent extends DomainEvent {
  eventType: 'PAYMENT_FAILED';
  aggregateType: 'PaymentIntent';
  payload: {
    customerId: CustomerId;
    failureReason: string;
    failureCode?: string;
  };
}

export interface PaymentRefundedEvent extends DomainEvent {
  eventType: 'PAYMENT_REFUNDED';
  aggregateType: 'PaymentIntent';
  payload: {
    customerId: CustomerId;
    refundAmount: MoneyData;
    totalRefunded: MoneyData;
    isFullRefund: boolean;
  };
}

/**
 * Ledger Events
 */
export interface LedgerEntriesCreatedEvent extends DomainEvent {
  eventType: 'LEDGER_ENTRIES_CREATED';
  aggregateType: 'Ledger';
  payload: {
    journalId: string;
    entries: Array<{
      entryId: LedgerEntryId;
      accountId: AccountId;
      type: string;
      direction: 'DEBIT' | 'CREDIT';
      amount: MoneyData;
    }>;
    paymentIntentId?: PaymentIntentId;
  };
}

export interface AccountBalanceUpdatedEvent extends DomainEvent {
  eventType: 'ACCOUNT_BALANCE_UPDATED';
  aggregateType: 'Account';
  payload: {
    previousBalance: MoneyData;
    newBalance: MoneyData;
    lastEntryId: LedgerEntryId;
  };
}

/**
 * Statement Events
 */
export interface StatementGeneratedEvent extends DomainEvent {
  eventType: 'STATEMENT_GENERATED';
  aggregateType: 'Statement';
  payload: {
    statementId: StatementId;
    type: string;
    ownerId?: OwnerId;
    customerId?: CustomerId;
    periodStart: Date;
    periodEnd: Date;
    openingBalance: MoneyData;
    closingBalance: MoneyData;
  };
}

export interface StatementSentEvent extends DomainEvent {
  eventType: 'STATEMENT_SENT';
  aggregateType: 'Statement';
  payload: {
    statementId: StatementId;
    recipientEmail: string;
    sentAt: Date;
  };
}

/**
 * Disbursement Events
 */
export interface DisbursementInitiatedEvent extends DomainEvent {
  eventType: 'DISBURSEMENT_INITIATED';
  aggregateType: 'Disbursement';
  payload: {
    ownerId: OwnerId;
    amount: MoneyData;
    destination: string;
    transferId: string;
  };
}

export interface DisbursementCompletedEvent extends DomainEvent {
  eventType: 'DISBURSEMENT_COMPLETED';
  aggregateType: 'Disbursement';
  payload: {
    ownerId: OwnerId;
    amount: MoneyData;
    completedAt: Date;
  };
}

export interface DisbursementFailedEvent extends DomainEvent {
  eventType: 'DISBURSEMENT_FAILED';
  aggregateType: 'Disbursement';
  payload: {
    ownerId: OwnerId;
    amount: MoneyData;
    failureReason: string;
  };
}

/**
 * Reconciliation Events
 */
export interface ReconciliationCompletedEvent extends DomainEvent {
  eventType: 'RECONCILIATION_COMPLETED';
  aggregateType: 'Reconciliation';
  payload: {
    reconciliationId: string;
    accountId: AccountId;
    matchedCount: number;
    unmatchedCount: number;
    exceptionCount: number;
    reconciliationDate: Date;
  };
}

export interface ReconciliationExceptionEvent extends DomainEvent {
  eventType: 'RECONCILIATION_EXCEPTION';
  aggregateType: 'Reconciliation';
  payload: {
    reconciliationId: string;
    paymentIntentId?: PaymentIntentId;
    externalId?: string;
    exceptionType: string;
    description: string;
  };
}

/**
 * Union type of all payment domain events
 */
export type PaymentDomainEvent =
  | PaymentIntentCreatedEvent
  | PaymentProcessingStartedEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | PaymentRefundedEvent
  | LedgerEntriesCreatedEvent
  | AccountBalanceUpdatedEvent
  | StatementGeneratedEvent
  | StatementSentEvent
  | DisbursementInitiatedEvent
  | DisbursementCompletedEvent
  | DisbursementFailedEvent
  | ReconciliationCompletedEvent
  | ReconciliationExceptionEvent;
