/**
 * M-Pesa Daraja 3.0 — barrel.
 *
 * Tight scope per `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md`:
 * STK Push (rent collection) + webhook handlers + signature verification.
 * C2B / B2C / reconciliation in a follow-up.
 *
 * For the legacy Daraja v2 adapter (full surface — STK / C2B / B2C /
 * status / balance) see `../mpesa-real.ts`.
 */

export {
  MPESA_BASE_URLS,
  E164_OR_LOCAL,
  StkPushInputSchema,
  StkPushOutputSchema,
  StkCallbackItemSchema,
  StkCallbackMetadataSchema,
  StkCallbackEnvelopeSchema,
  type MpesaEnv,
  type MpesaCredentials,
  type StkPushInput,
  type StkPushOutput,
  type StkCallbackItem,
  type StkCallbackEnvelope,
  type StkCallbackDecoded,
} from './types.js';

export {
  createMpesaClient,
  loadMpesaCredentialsFromEnv,
  type MpesaClient,
  type MpesaClientDeps,
} from './mpesa-client.js';

export {
  initiateStkPush,
  isoTimestampEAT,
  normaliseMsisdn,
  buildStkPushPassword,
  resolveCallbackUrl,
  type InitiateStkPushDeps,
} from './stk-push.js';

export {
  decodeStkCallback,
  stkCallbackReceiptKey,
  processStkCallback,
  createInMemoryIdempotencyStore,
  type IdempotencyStore,
  type ProcessStkCallbackDeps,
  type StkCallbackOutcome,
} from './webhook-handlers.js';

export {
  verifyMpesaWebhookOrigin,
  SAFARICOM_PRODUCTION_IPS,
  type MpesaWebhookOriginRequest,
  type MpesaWebhookOriginOptions,
  type VerifyResult,
} from './signature-verifier.js';
