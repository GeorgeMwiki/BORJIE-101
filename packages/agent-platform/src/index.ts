/**
 * @borjie/agent-platform — public API.
 */

// Types
export type {
  RegisteredAgent,
  AgentStatus,
  AgentScope,
  AgentAuthSuccess,
  AgentAuthError,
  AgentAuthResult,
  AgentErrorResponse,
  IdempotencyRecord,
  WebhookSubscription,
  WebhookSubscriptionStatus,
  WebhookDelivery,
  WebhookDeliveryStatus,
  AgentCard,
  AgentCardProvider,
  AgentCapability,
  AgentCardAuth,
  ToolSummary,
  ResourceSummary,
  AgentCardRateLimit,
} from './types.js';

export { ALL_AGENT_SCOPES, SUBSCRIBABLE_EVENTS } from './types.js';

// Error codes
export {
  createAgentError,
  getErrorHttpStatus,
  isRetryableError,
  type AgentErrorCode,
} from './error-codes.js';

// Correlation
export {
  getCorrelationId,
  correlationHeaders,
  forwardHeaders,
  type HeadersLike,
} from './correlation-id.js';

// Auth
export {
  verifyAgentRequest,
  buildCanonicalString,
  signRequest,
  generateAgentApiKey,
  generateAgentHmacSecret,
  hashApiKey,
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqual,
  type AgentAuthRequest,
  type AgentAuthDeps,
  type AgentRegistry,
} from './agent-auth.js';

// Idempotency
export {
  checkIdempotency,
  cacheIdempotencyResponse,
  createInMemoryIdempotencyStore,
  type IdempotencyStore,
  type IdempotencyCheck,
} from './idempotency.js';

// Webhook delivery
export {
  deliverToSubscription,
  type DeliverDeps,
  type DeliverEventPayload,
  type FetchLike,
  type WebhookStore,
} from './webhook-delivery.js';

// Agent card
export { generateAgentCard, type AgentCardDeps } from './agent-card.js';

// A2A (Agent-to-Agent) protocol v1.0 — Google / Linux Foundation
export * as a2a from './a2a/index.js';

// Junior Architecture (Wave 18V) — the contract every domain junior
// implements: persona + scope + escalation policy + audience-routing
// stub. Spec: docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md.
//
// Identity discipline: every junior renders as `MR_MWIKILA_DISPLAY_NAME`
// (singular brand across the product). A junior is a *specialisation*
// of Mr. Mwikila, not a separate character — see `JuniorPersona`.
export {
  MR_MWIKILA_DISPLAY_NAME,
  resolveAgentForUser,
  getJuniorDisplayName,
  getJuniorMode,
  juniorOwnsTabRecipe,
  juniorOwnsDocRecipe,
  juniorOwnsMediaRecipe,
  juniorServesAudience,
  type JuniorPersona,
  type JuniorMode,
  type JuniorScope,
  type JuniorLanguage,
  type Audience,
  type EscalationPolicy,
  type UserRole,
  type AgentResolution,
} from './junior-contract.js';

// Canonical user-facing display identity (founder correction — post 18V-FIX).
// The user always sees one string in the chat UI: "Mr. Mwikila — Borjie's
// AI Mining Operations Manager". No specialisation subtitle, no agent_id.
// Spec: Docs/DESIGN/CAPABILITIES_UNIFICATION.md "User-facing identity is
// locked".
export {
  MR_MWIKILA_CANONICAL_DISPLAY,
  type MrMwikilaCanonicalDisplay,
} from './canonical-display.js';
