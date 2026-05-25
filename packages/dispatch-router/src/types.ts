/**
 * Piece L — Brain↔Tab Loop public types.
 *
 * All shapes are runtime-validated via Zod so the dispatcher boundary
 * is robust to slightly-malformed inputs from the kernel side. Codify
 * the conventions (no string unions in raw form; enums via z.enum so
 * mistyped values fail loudly).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Intents
// ─────────────────────────────────────────────────────────────────────

export const IntentSchema = z.enum([
  'request_info',
  'propose_action',
  'file_event',
  'ask_for_help',
  'ambiguous',
]);
export type Intent = z.infer<typeof IntentSchema>;

// ─────────────────────────────────────────────────────────────────────
// Decision-kind we capture for (refusal is dropped on the floor)
// ─────────────────────────────────────────────────────────────────────

export const CapturedDecisionKindSchema = z.enum(['answer', 'softened']);
export type CapturedDecisionKind = z.infer<typeof CapturedDecisionKindSchema>;

// ─────────────────────────────────────────────────────────────────────
// Resolved entity
// ─────────────────────────────────────────────────────────────────────

export const ResolvedEntityTypeSchema = z.enum([
  'customer',
  'unit',
  'property',
  'lease',
  'amount',
  'date',
  'district',
  'tenant_user',
  'document',
  'invoice',
  'maintenance_ticket',
]);
export type ResolvedEntityType = z.infer<typeof ResolvedEntityTypeSchema>;

export const ResolvedEntitySchema = z.object({
  type: ResolvedEntityTypeSchema,
  /** Canonical id from core entities (e.g. `customers.id`). */
  canonical_id: z.string().min(1),
  /** Verbatim text the extractor saw. */
  raw_value: z.string(),
  /** Confidence in the resolution result. */
  confidence: z.number().min(0).max(1),
  /** Source: 'regex_ner' | 'llm_ner' | 'graph_traversal' | 'cache'. */
  source: z.string(),
});
export type ResolvedEntity = z.infer<typeof ResolvedEntitySchema>;

// ─────────────────────────────────────────────────────────────────────
// Conversation capture
// ─────────────────────────────────────────────────────────────────────

export const ConversationCaptureSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  thread_id: z.string().nullable(),
  message_id: z.string().nullable(),
  persona_id: z.string().min(1),
  user_id: z.string().nullable(),
  user_text: z.string(),
  assistant_text: z.string(),
  decision_kind: CapturedDecisionKindSchema,
  entities: z.array(ResolvedEntitySchema),
  intent: IntentSchema,
  intent_confidence: z.number().min(0).max(1),
  capture_confidence: z.number().min(0).max(1),
  persona_trust: z.number().min(0).max(1),
  tenant_trust: z.number().min(0).max(1),
  attributes: z.record(z.unknown()),
  exchange_hash: z.string(),
  latency_ms: z.number().int().min(0),
  created_at: z.string(),
});
export type ConversationCapture = z.infer<typeof ConversationCaptureSchema>;

// ─────────────────────────────────────────────────────────────────────
// Module update proposal
// ─────────────────────────────────────────────────────────────────────

export const ProposalStatusSchema = z.enum([
  'pending_hitl',
  'auto_applying',
  'accepted',
  'declined',
  'edited',
  'expired',
  'failed',
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const PrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof PrioritySchema>;

export const ModuleUpdateProposalSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  capture_id: z.string().min(1),
  module_template_id: z.string().min(1),
  action: z.string().min(1),
  persona_id: z.string().min(1),
  status: ProposalStatusSchema,
  confidence: z.number().min(0).max(1),
  hitl_required: z.boolean(),
  priority: PrioritySchema,
  payload: z.record(z.unknown()),
  entity_refs: z.array(ResolvedEntitySchema),
  matrix_row_id: z.string().nullable(),
  approver_tier: z.number().int().min(1).max(5).nullable(),
  approver_user_id: z.string().nullable(),
  decline_reason: z.string().nullable(),
  edited_from_id: z.string().nullable(),
  failure_reason: z.string().nullable(),
  resolved_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ModuleUpdateProposal = z.infer<typeof ModuleUpdateProposalSchema>;

// ─────────────────────────────────────────────────────────────────────
// Routing decision (matrix row × capture combination output)
// ─────────────────────────────────────────────────────────────────────

export const RoutingDecisionSchema = z.object({
  matrix_row_id: z.string(),
  module_template_id: z.string(),
  action: z.string(),
  /** Confidence ABOVE which we auto-apply (skip HITL). */
  auto_apply_threshold: z.number().min(0).max(1),
  /** Confidence ABOVE which we even create a proposal at all. */
  min_confidence: z.number().min(0).max(1),
  /** If false, action goes straight to auto_applying when confidence allows. */
  hitl_required: z.boolean(),
  priority: PrioritySchema,
  /** Persona tier minimum required to approve (1..5). */
  min_approver_tier: z.number().int().min(1).max(5),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

// ─────────────────────────────────────────────────────────────────────
// Routing matrix row (input shape)
// ─────────────────────────────────────────────────────────────────────

export const RoutingMatrixRowSchema = z.object({
  id: z.string(),
  /** Entity type the rule fires on (e.g. 'customer'). */
  entity_type: ResolvedEntityTypeSchema,
  /** Intent the rule fires on. */
  intent: IntentSchema,
  module_template_id: z.string(),
  action: z.string(),
  /** Minimum capture confidence to fire this rule. */
  min_confidence: z.number().min(0).max(1),
  /** Confidence threshold above which we auto-apply (skip HITL). */
  auto_apply_threshold: z.number().min(0).max(1),
  hitl_required: z.boolean(),
  priority: PrioritySchema,
  min_approver_tier: z.number().int().min(1).max(5),
  /** Optional jurisdiction filter ('TZ' | 'KE' | 'NG' | '*'). */
  jurisdiction: z.string().default('*'),
  /** Optional tenant override id; '*' means platform-default row. */
  tenant_scope: z.string().default('*'),
});
export type RoutingMatrixRow = z.infer<typeof RoutingMatrixRowSchema>;

// ─────────────────────────────────────────────────────────────────────
// Tab event log entry
// ─────────────────────────────────────────────────────────────────────

export const TabEventKindSchema = z.enum([
  'capture_emitted',
  'proposal_created',
  'proposal_auto_applied',
  'proposal_pending_hitl',
  'proposal_approved',
  'proposal_declined',
  'proposal_edited',
  'proposal_expired',
  'proposal_failed',
  'proactive_nudge',
]);
export type TabEventKind = z.infer<typeof TabEventKindSchema>;

export const TabEventLogEntrySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  capture_id: z.string().nullable(),
  proposal_id: z.string().nullable(),
  module_template_id: z.string().nullable(),
  persona_id: z.string(),
  event_kind: TabEventKindSchema,
  actor: z.string(),
  transport: z.string(),
  snapshot: z.record(z.unknown()),
  notes: z.string().nullable(),
  sequence: z.number().int().min(0),
  created_at: z.string(),
});
export type TabEventLogEntry = z.infer<typeof TabEventLogEntrySchema>;

// ─────────────────────────────────────────────────────────────────────
// Audit chain link (subset of ai_audit_chain row the capture writes)
// ─────────────────────────────────────────────────────────────────────

export const AuditChainLinkSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  turn_id: z.string(),
  session_id: z.string().nullable(),
  action: z.string(),
  prev_hash: z.string(),
  this_hash: z.string(),
  payload: z.record(z.unknown()),
  sequence_id: z.number().int().min(0),
});
export type AuditChainLink = z.infer<typeof AuditChainLinkSchema>;

// ─────────────────────────────────────────────────────────────────────
// Capture input + dispatch result envelopes
// ─────────────────────────────────────────────────────────────────────

export interface PersonaContext {
  readonly persona_id: string;
  /** Tier 1..5 (1 = highest trust). */
  readonly tier: 1 | 2 | 3 | 4 | 5;
  /** Jurisdiction the persona is operating in ('TZ', 'KE', ...). */
  readonly jurisdiction?: string;
  /** Optional scope predicate string (Piece D). */
  readonly scope_predicate?: string;
}

export interface CaptureInput {
  readonly tenant_id: string;
  readonly persona: PersonaContext;
  readonly user_text: string;
  readonly assistant_text: string;
  readonly decision_kind: CapturedDecisionKind;
  readonly thread_id?: string | null;
  readonly message_id?: string | null;
  readonly user_id?: string | null;
  /** Optional pre-extracted entities (from kernel). */
  readonly pre_extracted_entities?: ReadonlyArray<{
    readonly type: string;
    readonly value: string;
    readonly confidence: number;
  }>;
  /** Optional tenant trust override (defaults to 0.8). */
  readonly tenant_trust?: number;
}

export interface DispatchInput {
  readonly tenant_id: string;
  readonly capture: ConversationCapture;
  readonly persona: PersonaContext;
  /** Override matrix (defaults to PLATFORM_ROUTING_MATRIX). */
  readonly matrix?: ReadonlyArray<RoutingMatrixRow>;
  /** Optional accept-proposal handler registry (Piece B integration). */
  readonly handlerRegistry?: AcceptHandlerRegistry;
}

// ─────────────────────────────────────────────────────────────────────
// Handler registry
// ─────────────────────────────────────────────────────────────────────

export interface AcceptHandlerArgs {
  readonly tenant_id: string;
  readonly proposal: ModuleUpdateProposal;
}

export interface AcceptHandlerResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Side-effects the handler wrote (e.g. inserted row ids) — for audit. */
  readonly artifacts?: ReadonlyArray<{
    readonly type: string;
    readonly id: string;
  }>;
}

export type AcceptHandler = (
  args: AcceptHandlerArgs,
) => Promise<AcceptHandlerResult>;

export interface AcceptHandlerRegistry {
  get(
    moduleTemplateId: string,
    action: string,
  ): AcceptHandler | undefined;
  /** Used by the stub registry to record calls for assertions. */
  listInvocations?(): ReadonlyArray<AcceptHandlerArgs>;
}

// ─────────────────────────────────────────────────────────────────────
// Resolver port — the canonical-entity lookup the capture uses
// ─────────────────────────────────────────────────────────────────────

export interface CanonicalResolverArgs {
  readonly tenant_id: string;
  readonly raw_type: string;
  readonly raw_value: string;
}

export interface CanonicalResolverResult {
  readonly type: ResolvedEntityType;
  readonly canonical_id: string;
  readonly confidence: number;
  readonly source: string;
}

/** Returns `null` when the entity cannot be resolved canonically.
 *  Capture drops entities that fail resolution (no hallucinations). */
export type CanonicalResolver = (
  args: CanonicalResolverArgs,
) => Promise<CanonicalResolverResult | null>;

// ─────────────────────────────────────────────────────────────────────
// Intent classifier port
// ─────────────────────────────────────────────────────────────────────

export interface IntentClassifierArgs {
  readonly user_text: string;
  readonly assistant_text: string;
  readonly persona_id: string;
}

export interface IntentClassifierResult {
  readonly intent: Intent;
  readonly confidence: number;
  /** Optional explanation (debug only — not persisted). */
  readonly rationale?: string;
}

export type IntentClassifier = (
  args: IntentClassifierArgs,
) => Promise<IntentClassifierResult>;

// ─────────────────────────────────────────────────────────────────────
// Clock + RNG ports (DI for determinism in tests)
// ─────────────────────────────────────────────────────────────────────

export type ClockFn = () => Date;
export type RandomIdFn = () => string;
