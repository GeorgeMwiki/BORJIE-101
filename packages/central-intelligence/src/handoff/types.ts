/**
 * Knowledge handoff — shared types.
 *
 * Four small primitives back the cross-role handoff chain:
 *
 *   1. ChatHandoff           one row per "@Manager-John please ..." emission
 *   2. HandoffScopePayload   structured context the recipient needs to act
 *   3. HandoffResolution     'replied' | 'closed' | 'declined'
 *   4. HandoffPersonaRole    persona slug of the recipient at handoff time
 *
 * No mutation, no I/O. Pure types consumed by the parser, the recorder,
 * and the FE chip renderer.
 */

export const HANDOFF_PERSONA_ROLES = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
  'T4_field_employee',
  'T5_customer_concierge',
  'T_auditor',
  'T_vendor',
] as const;
export type HandoffPersonaRole = (typeof HANDOFF_PERSONA_ROLES)[number];

export const HANDOFF_RESOLUTIONS = ['replied', 'closed', 'declined'] as const;
export type HandoffResolution = (typeof HANDOFF_RESOLUTIONS)[number];

export interface HandoffScopePayload {
  readonly siteIds?: ReadonlyArray<string>;
  readonly category?: string;
  readonly sourceTurnId?: string | null;
  readonly entityKind?: string;
  readonly entityId?: string;
  /** Free-form extra context the parser preserves verbatim. */
  readonly [key: string]: unknown;
}

export interface ChatHandoff {
  readonly id: string;
  readonly tenantId: string;
  readonly sourceSessionId: string;
  readonly sourceUserId: string;
  readonly targetUserId: string;
  readonly targetRole: HandoffPersonaRole;
  readonly topic: string;
  readonly scopePayload: HandoffScopePayload;
  readonly resolvedAt: string | null;
  readonly resolution: HandoffResolution | null;
  readonly replyText: string | null;
  readonly auditChainSeq: number;
  readonly entryHash: string;
  readonly prevHash: string | null;
  readonly createdAt: string;
}

/**
 * Input accepted by `recordHandoff`.
 */
export interface RecordHandoffInput {
  readonly tenantId: string;
  readonly sourceSessionId: string;
  readonly sourceUserId: string;
  readonly targetUserId: string;
  readonly targetRole: HandoffPersonaRole;
  readonly topic: string;
  readonly scopePayload?: HandoffScopePayload;
}

/**
 * Input accepted by `resolveHandoff`.
 */
export interface ResolveHandoffInput {
  readonly tenantId: string;
  readonly handoffId: string;
  readonly resolution: HandoffResolution;
  readonly replyText?: string | null;
}

/**
 * Error raised when a handoff input fails validation or cross-tenant
 * routing is attempted. Carries a stable code so the caller can branch
 * on it without parsing the message.
 */
export class HandoffError extends Error {
  readonly code:
    | 'invalid_input'
    | 'cross_tenant_denied'
    | 'persistence_failed'
    | 'unknown_handoff'
    | 'rls_scope_denied';
  constructor(
    code:
      | 'invalid_input'
      | 'cross_tenant_denied'
      | 'persistence_failed'
      | 'unknown_handoff'
      | 'rls_scope_denied',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'HandoffError';
  }
}
