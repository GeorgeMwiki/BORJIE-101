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

// Re-export the hash-chain extension type (`ChainedLedgerEntry`) so
// out-of-package adapters (the api-gateway live-money ledger adapter)
// can stamp `prevHash`/`thisHash` on entries with the SAME type the
// payments-ledger repositories use. Type-only re-export — no runtime
// surface beyond the side-effect import above.
export type { ChainedLedgerEntry } from './domain-extensions';

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

// Ledger hash-chain (durability defect #3) — the SHARED tamper-evidence
// helper. Out-of-package adapters (api-gateway live-money path) MUST
// import `computeEntryHash` / `GENESIS_HASH` from here so the chain they
// stamp is byte-identical to the one the payments-ledger repositories
// compute (parity). Never re-implement the hash. `verifyHashChain` +
// `HashableEntry` are exported so consumers can verify a chain segment.
export {
  computeEntryHash,
  GENESIS_HASH,
  verifyHashChain,
  type HashableEntry,
  type HashChainVerification,
} from './services/ledger-hash-chain';
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
