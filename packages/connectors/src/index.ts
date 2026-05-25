/**
 * @borjie/connectors — public surface.
 *
 * Every external integration Borjie ships should compose through
 * `createBaseConnector` so it inherits common rate-limiting / circuit-breaker
 * / retry / audit / event-bus discipline. The two adapters here (M-Pesa,
 * credit bureau) are illustrative; real adapters live alongside their
 * domain code.
 */

export {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type BaseConnectorDeps,
  type CircuitHealth,
  type ConnectorAuth,
  type ConnectorConfig,
  type ConnectorEvent,
  type ConnectorEventSink,
  type ConnectorOutcome,
  type ConnectorRequest,
} from './base-connector.js';

export { createInMemoryEventSink, type InMemoryEventSink } from './in-memory-event-sink.js';
export { createInMemoryAuditSink, type InMemoryAuditSink } from './in-memory-audit-sink.js';

export {
  createMpesaAdapter,
  InitiatePaymentInputSchema,
  InitiatePaymentOutputSchema,
  type InitiatePaymentInput,
  type InitiatePaymentOutput,
  type MpesaAdapter,
  type MpesaAdapterDeps,
} from './adapters/mpesa-adapter.js';

export {
  createCreditBureauAdapter,
  FetchScoreInputSchema,
  CreditScoreReportSchema,
  type CreditBureauAdapter,
  type CreditBureauAdapterDeps,
  type CreditScoreReport,
  type FetchScoreInput,
} from './adapters/credit-bureau-adapter.js';

export {
  createNidaAdapter,
  NidaNumberSchema,
  BiometricHashSchema,
  VerifyIdentityInputSchema,
  VerifyIdentityOutputSchema,
  type NidaAdapter,
  type NidaAdapterDeps,
  type VerifyIdentityInput,
  type VerifyIdentityOutput,
} from './adapters/nida-adapter.js';

export {
  createEardhiAdapter,
  TitleNumberSchema,
  VerifyTitleInputSchema,
  VerifyTitleOutputSchema,
  EncumbranceSchema,
  type EardhiAdapter,
  type EardhiAdapterDeps,
  type VerifyTitleInput,
  type VerifyTitleOutput,
  type Encumbrance,
} from './adapters/eardhi-adapter.js';

// ─────────────────────────────────────────────────────────────────────
// Phase F.4 — production-grade real adapters (sandbox + production env).
// These adapters talk to real sandbox endpoints; tests inject `fetch`.
// ─────────────────────────────────────────────────────────────────────

export {
  createMpesaRealAdapter,
  StkPushInputSchema,
  StkPushOutputSchema,
  C2bRegisterUrlInputSchema,
  C2bRegisterUrlOutputSchema,
  C2bCallbackPayloadSchema,
  B2cInputSchema,
  B2cOutputSchema,
  TransactionStatusInputSchema,
  TransactionStatusOutputSchema,
  AccountBalanceInputSchema,
  AccountBalanceOutputSchema,
  type MpesaEnv,
  type MpesaRealAdapter,
  type MpesaRealAdapterDeps,
  type MpesaRealCredentials,
  type StkPushInput,
  type StkPushOutput,
  type C2bRegisterUrlInput,
  type C2bRegisterUrlOutput,
  type C2bCallbackPayload,
  type B2cInput,
  type B2cOutput,
  type TransactionStatusInput,
  type TransactionStatusOutput,
  type AccountBalanceInput,
  type AccountBalanceOutput,
} from './adapters/mpesa-real.js';

export {
  createKraEritsRealAdapter,
  validateTaxPeriod,
  TaxPeriodSchema,
  KraPinSchema,
  OwnerEntrySchema,
  SubmitMriInputSchema,
  SubmitMriOutputSchema,
  GetReceiptInputSchema,
  GetReceiptOutputSchema,
  CancelFilingInputSchema,
  CancelFilingOutputSchema,
  ReceiptStatusSchema,
  RejectionDetailSchema,
  type KraEnv,
  type KraEritsRealAdapter,
  type KraEritsRealAdapterDeps,
  type KraEritsCredentials,
  type OwnerEntry,
  type SubmitMriInput,
  type SubmitMriOutput,
  type GetReceiptInput,
  type GetReceiptOutput,
  type CancelFilingInput,
  type CancelFilingOutput,
  type ReceiptStatus,
  type RejectionDetail,
} from './adapters/kra-erits-real.js';

export {
  createNidaRealAdapter,
  NidaNumberSchema as NidaRealNumberSchema,
  BiometricHashSchema as NidaRealBiometricHashSchema,
  VerifyIdentityInputSchema as NidaRealVerifyIdentityInputSchema,
  VerifyIdentityOutputSchema as NidaRealVerifyIdentityOutputSchema,
  type NidaEnv,
  type NidaAuthMode,
  type NidaRealAdapter,
  type NidaRealAdapterDeps,
} from './adapters/nida-real.js';

export {
  createGepgRealAdapter,
  toGepgBillXml,
  extractXmlTag,
  GenerateControlNumberInputSchema,
  GenerateControlNumberOutputSchema,
  InquireStatusInputSchema,
  InquireStatusOutputSchema,
  CancelInputSchema as GepgCancelInputSchema,
  CancelOutputSchema as GepgCancelOutputSchema,
  ControlNumberStatusSchema,
  DailyReconciliationInputSchema,
  DailyReconciliationOutputSchema,
  ReconciliationEntrySchema,
  type GepgEnv,
  type GepgFormat,
  type GepgCredentials,
  type GepgRealAdapter,
  type GepgRealAdapterDeps,
  type GenerateControlNumberInput,
  type GenerateControlNumberOutput,
  type InquireStatusInput,
  type InquireStatusOutput,
  type CancelInput as GepgCancelInput,
  type CancelOutput as GepgCancelOutput,
  type ControlNumberStatus,
  type DailyReconciliationInput,
  type DailyReconciliationOutput,
  type ReconciliationEntry,
} from './adapters/gepg-real.js';

export * from './registry.js';
export * from './orchestrator.js';
export * from './health-scheduler.js';

// ─────────────────────────────────────────────────────────────────────
// Slack connector — operator-team brain feed.
// Wave-2 task #11.3 of `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`.
// Per-tenant Slack app install: every export here is tenant-scoped.
// ─────────────────────────────────────────────────────────────────────
export * from './adapters/slack/index.js';
