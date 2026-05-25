/**
 * BORJIE Payments & Ledger Service
 * 
 * Core financial services including:
 * - Payment orchestration with pluggable providers
 * - Immutable double-entry ledger
 * - Bank reconciliation
 * - Statement generation
 * - Invoice generation
 * - Owner disbursements
 * 
 * @packageDocumentation
 */

// Domain extensions – must be imported first to augment Money prototype
import './domain-extensions';

// =============================================================================
// Types (used internally - import directly from './types' when needed)
// =============================================================================

// =============================================================================
// Providers
// =============================================================================
export * from './providers/payment-provider.interface';
export * from './providers/stripe-provider';
export * from './providers/mpesa-provider';

// =============================================================================
// Core Services
// =============================================================================
export * from './services/payment-orchestration.service';
export * from './services/ledger.service';
export * from './services/reconciliation.service';
export * from './services/statement-generation.service';
export * from './services/disbursement.service';

// =============================================================================
// Document Generators
// =============================================================================
export * from './services/invoice.generator';
export * from './services/statement.generator';

// =============================================================================
// Events
// =============================================================================
export * from './events/payment-events';
export * from './events/event-publisher';

// =============================================================================
// Repositories (interfaces)
// =============================================================================
export * from './repositories/payment-intent.repository';
export * from './repositories/ledger.repository';
export * from './repositories/account.repository';
export * from './repositories/statement.repository';
export * from './repositories/disbursement.repository';

// =============================================================================
// Jobs
// =============================================================================
export * from './jobs/reconciliation.job';
export * from './jobs/statement-generation.job';
export * from './jobs/disbursement.job';
