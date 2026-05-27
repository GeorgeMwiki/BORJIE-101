/**
 * Stripe provider — barrel.
 *
 * Public surface for the api-gateway and tests. The webhook handler is
 * the only path that touches `LedgerService.postJournalEntry`.
 */
export {
  type IStripeClient,
  type CheckoutSessionRequest,
  type CheckoutSessionResponse,
  // `RefundRequest` clashes with the orchestration-layer `RefundRequest`
  // from payment-orchestration.service when both are re-exported from
  // the root index. Re-export as `StripeRefundRequest` to keep the
  // top-level barrel unambiguous; consumers that need both can import
  // each from its scoped path.
  type RefundRequest as StripeRefundRequest,
  type RefundResponse as StripeRefundResponse,
  type StripeWebhookEvent,
  type StripeWebhookEventObject,
  type MockStripeScenario,
  type MockStripeClientOptions,
  type QueuedStripeWebhook,
  LiveStripeClient,
  MockStripeClient,
  createStripeClient,
  isStripeLiveMode,
} from './client';
export {
  type CheckoutSessionInput,
  type CreateCheckoutSessionDeps,
  type CreateCheckoutSessionResult,
  CheckoutSessionInputSchema,
  createCheckoutSession,
} from './checkout-session';
export {
  type StripeTenantContext,
  type StripeTenantResolver,
  type StripeWebhookHandlerDeps,
  type StripeWebhookResult,
  handleStripeWebhook,
} from './webhook-handler';
