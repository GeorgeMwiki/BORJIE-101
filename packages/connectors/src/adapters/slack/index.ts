/**
 * Slack connector — barrel export.
 *
 * Public surface used by the composition root that wires per-tenant
 * Slack apps onto the brain-event bus. Mirrors the layering of the
 * WhatsApp connector at `services/notifications/src/whatsapp/`:
 *
 *   - Web client (`slack-client.ts`) — Bolt-style web API wrapper
 *     composed through the platform's base connector.
 *   - Events handler (`events-handler.ts`) — front door for inbound
 *     event-subscriptions; runs signature verify → JSON parse → emit.
 *   - ACL resolver (`acl-resolver.ts`) — channel → readers, with DM
 *     vs private vs public discrimination.
 *   - Signature verifier (`signature-verifier.ts`) — Slack v0
 *     HMAC-SHA256 with timing-safe compare.
 *   - Decision-pattern miner (`decision-pattern-miner.ts`) — pure
 *     keyword-based intent recognition stub.
 *   - Brain-event emitter (`brain-event-emitter.ts`) — emits
 *     `comms.slack.inbound` events with full ACL envelope.
 *
 * Wave-2 task #11.3 of
 * `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`.
 * Research report: `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`.
 */

export {
  createSlackClient,
  type SlackClient,
  type SlackClientDeps,
  type SlackConversationInfo,
  type SlackConversationMembersPage,
  type SlackOauthV2AccessInput,
  type SlackOauthV2AccessOutput,
} from './slack-client.js';

export {
  verifySlackSignature,
  type VerifySlackSignatureOptions,
} from './signature-verifier.js';

export {
  createSlackAclResolver,
  SlackAclResolver,
  type SlackACLResolverOptions,
} from './acl-resolver.js';

export {
  mineMessagePattern,
  SLACK_MINER_RULES,
} from './decision-pattern-miner.js';

export {
  createSlackBrainEventEmitter,
  SlackBrainEventEmitter,
  type SlackBrainEventEmitterOptions,
} from './brain-event-emitter.js';

export {
  createSlackEventsHandler,
  SlackEventsHandler,
  type SlackEventsHandlerOptions,
  type SlackHandleOutcome,
  type SlackEventHeaders,
} from './events-handler.js';

export type {
  BrainEvent,
  BrainEventACL,
  BrainEventPublisher,
  BrainEventSource,
  SlackAppMentionEvent,
  SlackChannelACL,
  SlackChannelACLResolver,
  SlackChatPostMessageInput,
  SlackChatPostMessageOutput,
  SlackEvent,
  SlackEventCallbackEnvelope,
  SlackEventEnvelope,
  SlackMessageEvent,
  SlackMinedPattern,
  SlackReactionAddedEvent,
  SlackRecognisedIntent,
  SlackSignatureVerifyFailReason,
  SlackSignatureVerifyInput,
  SlackSignatureVerifyOutcome,
  SlackTenantInstall,
  SlackUrlVerificationEnvelope,
  SlackUserInfo,
  SlackUserResolver,
} from './types.js';
