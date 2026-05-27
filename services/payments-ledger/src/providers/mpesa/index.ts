/**
 * M-Pesa provider — barrel.
 *
 * Public surface for the api-gateway and tests. The webhook handler is
 * the only path that touches `LedgerService.postJournalEntry`.
 */
export {
  type IMpesaClient,
  type StkPushRequest,
  type StkPushResponse,
  type StkQueryResponse,
  type B2CRequest,
  type B2CResponse,
  type MockMpesaScenario,
  type MockMpesaClientOptions,
  type QueuedMpesaCallback,
  type StkCallbackPayload,
  LiveMpesaClient,
  MockMpesaClient,
  createMpesaClient,
  isMpesaLiveMode,
} from './client';
export {
  type StkPushInput,
  type InitiateStkPushDeps,
  type InitiateStkPushResult,
  StkPushInputSchema,
  initiateStkPush,
  normalisePhone,
} from './stk-push';
export {
  type MpesaTenantContext,
  type MpesaTenantResolver,
  type MpesaWebhookHandlerDeps,
  type MpesaSignatureHeaders,
  type MpesaWebhookResult,
  type ParsedStkCallback,
  handleMpesaWebhook,
  verifyMpesaSignature,
} from './webhook-handler';
