/**
 * Piece L — Dispatch logic.
 *
 * Reads a finalised `ConversationCapture` and emits one or more
 * `ModuleUpdateProposal` rows by walking the routing matrix.
 *
 * Algorithm:
 *   1. For each resolved entity in the capture:
 *      For each matrix row whose (entity_type, intent) matches AND
 *      whose jurisdiction filter passes AND whose tenant_scope matches:
 *        - If capture_confidence < row.min_confidence → skip
 *        - Build a proposal with status='pending_hitl' OR 'auto_applying'
 *          based on (confidence ≥ row.auto_apply_threshold) AND
 *          (row.hitl_required = false) AND
 *          (confidence ≥ GLOBAL_AUTO_APPLY_FLOOR)
 *        - Persist the proposal
 *        - Hash-chain into ai_audit_chain
 *        - Append a tab_event_log row
 *        - If status='auto_applying', invoke the handler synchronously
 *          and flip the row to 'accepted' on success, 'failed' on error
 *
 * Returns the array of proposals created (in matrix order).
 */

import { randomUUID } from 'crypto';
import {
  GLOBAL_AUTO_APPLY_FLOOR,
  PLATFORM_ROUTING_MATRIX,
} from './matrix-defaults.js';
import type { AuditChainSink } from './audit-link.js';
import type {
  ModuleUpdateProposalStore,
  TabEventLogStore,
} from './store.js';
import type {
  AcceptHandlerRegistry,
  ClockFn,
  ConversationCapture,
  DispatchInput,
  ModuleUpdateProposal,
  PersonaContext,
  RandomIdFn,
  ResolvedEntity,
  RoutingMatrixRow,
  TabEventLogEntry,
  TabEventKind,
} from './types.js';

export interface DispatchDeps {
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly eventLog: TabEventLogStore;
  readonly auditSink: AuditChainSink;
  readonly clock?: ClockFn;
  readonly randomId?: RandomIdFn;
  /**
   * TTL applied to newly-created proposals. Defaults to 7 days; the
   * cron job at the api-gateway flips expired rows to 'expired'.
   */
  readonly proposalTtlMs?: number;
}

const DEFAULT_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dispatch a capture to module tabs via the routing matrix. Returns
 * the proposals created.
 */
export async function dispatchToTabs(
  input: DispatchInput,
  deps: DispatchDeps,
): Promise<ReadonlyArray<ModuleUpdateProposal>> {
  const matrix = input.matrix ?? PLATFORM_ROUTING_MATRIX;
  const now = deps.clock ? deps.clock() : new Date();
  const newId = deps.randomId ?? randomUUID;
  const ttlMs = deps.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs);

  const proposals: ModuleUpdateProposal[] = [];

  // Walk each entity × matrix-row combination.
  let sequence = 1;
  for (const entity of input.capture.entities) {
    for (const row of matrix) {
      if (!matrixRowMatches(row, entity, input.capture, input.persona)) continue;

      const proposal = await createProposalFromMatrixRow({
        capture: input.capture,
        entity,
        row,
        persona: input.persona,
        now,
        newId,
        expiresAt,
        proposalStore: deps.proposalStore,
        auditSink: deps.auditSink,
        eventLog: deps.eventLog,
        sequence: sequence++,
      });
      proposals.push(proposal);

      // If we flipped to 'auto_applying', call the handler.
      if (proposal.status === 'auto_applying' && input.handlerRegistry) {
        await invokeHandler({
          proposal,
          tenant_id: input.tenant_id,
          handlerRegistry: input.handlerRegistry,
          proposalStore: deps.proposalStore,
          auditSink: deps.auditSink,
          eventLog: deps.eventLog,
          newId,
          clock: now,
          sequence: sequence++,
        });
      }
    }
  }

  return proposals;
}

/**
 * Promote a `pending_hitl` proposal to `accepted` after a human approves.
 * Invokes the registered handler and chains the result into the audit log.
 *
 * Idempotent: calling twice on an already-accepted proposal is a no-op
 * that returns the latest row.
 */
export async function approveProposal(args: {
  readonly tenant_id: string;
  readonly proposal_id: string;
  readonly approver_user_id: string;
  readonly approver_tier: 1 | 2 | 3 | 4 | 5;
  readonly handlerRegistry: AcceptHandlerRegistry;
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly auditSink: AuditChainSink;
  readonly eventLog: TabEventLogStore;
  readonly clock?: ClockFn;
  readonly randomId?: RandomIdFn;
}): Promise<ModuleUpdateProposal> {
  const now = args.clock ? args.clock() : new Date();
  const newId = args.randomId ?? randomUUID;

  const existing = await args.proposalStore.findById(
    args.tenant_id,
    args.proposal_id,
  );
  if (!existing) {
    throw new Error(`proposal ${args.proposal_id} not found`);
  }
  if (existing.status === 'accepted') return existing;
  if (
    existing.status !== 'pending_hitl' &&
    existing.status !== 'edited'
  ) {
    throw new Error(
      `proposal ${args.proposal_id} cannot be approved from status=${existing.status}`,
    );
  }

  // Tier-gate check: approver tier must be ≤ row's min_approver_tier.
  if (
    typeof existing.approver_tier === 'number' &&
    args.approver_tier > (existing as { approver_tier?: number }).approver_tier!
  ) {
    throw new Error(
      `approver tier ${args.approver_tier} below required ${existing.approver_tier} for proposal ${args.proposal_id}`,
    );
  }

  // Invoke handler.
  const handler = args.handlerRegistry.get(
    existing.module_template_id,
    existing.action,
  );
  if (!handler) {
    const failed = await args.proposalStore.update(
      args.tenant_id,
      args.proposal_id,
      {
        status: 'failed',
        failure_reason: `no handler for ${existing.module_template_id}.${existing.action}`,
        resolved_at: now.toISOString(),
      },
    );
    await appendEvent({
      eventLog: args.eventLog,
      newId,
      proposal: failed,
      event_kind: 'proposal_failed',
      actor: `user:${args.approver_user_id}`,
      transport: 'api',
      sequence: 10,
      now,
      notes: 'handler missing',
    });
    return failed;
  }

  const handlerResult = await handler({
    tenant_id: args.tenant_id,
    proposal: existing,
  });

  if (!handlerResult.ok) {
    const failed = await args.proposalStore.update(
      args.tenant_id,
      args.proposal_id,
      {
        status: 'failed',
        failure_reason: handlerResult.error ?? 'handler returned ok=false',
        resolved_at: now.toISOString(),
      },
    );
    await appendEvent({
      eventLog: args.eventLog,
      newId,
      proposal: failed,
      event_kind: 'proposal_failed',
      actor: `user:${args.approver_user_id}`,
      transport: 'api',
      sequence: 10,
      now,
      notes: handlerResult.error ?? null,
    });
    await args.auditSink.append({
      tenant_id: args.tenant_id,
      turn_id: failed.capture_id,
      session_id: null,
      action: 'proposal_failed',
      payload: {
        proposal_id: failed.id,
        error: handlerResult.error ?? null,
      },
    });
    return failed;
  }

  const accepted = await args.proposalStore.update(
    args.tenant_id,
    args.proposal_id,
    {
      status: 'accepted',
      approver_user_id: args.approver_user_id,
      approver_tier: args.approver_tier,
      resolved_at: now.toISOString(),
    },
  );
  await appendEvent({
    eventLog: args.eventLog,
    newId,
    proposal: accepted,
    event_kind: 'proposal_approved',
    actor: `user:${args.approver_user_id}`,
    transport: 'api',
    sequence: 10,
    now,
    notes: null,
    extraSnapshot: { artifacts: handlerResult.artifacts ?? [] },
  });
  await args.auditSink.append({
    tenant_id: args.tenant_id,
    turn_id: accepted.capture_id,
    session_id: null,
    action: 'proposal_approved',
    payload: {
      proposal_id: accepted.id,
      approver_user_id: args.approver_user_id,
      approver_tier: args.approver_tier,
      artifacts: handlerResult.artifacts ?? [],
    },
  });
  return accepted;
}

/**
 * Decline a pending proposal with a reason.
 */
export async function declineProposal(args: {
  readonly tenant_id: string;
  readonly proposal_id: string;
  readonly approver_user_id: string;
  readonly reason: string;
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly auditSink: AuditChainSink;
  readonly eventLog: TabEventLogStore;
  readonly clock?: ClockFn;
  readonly randomId?: RandomIdFn;
}): Promise<ModuleUpdateProposal> {
  const now = args.clock ? args.clock() : new Date();
  const newId = args.randomId ?? randomUUID;

  const existing = await args.proposalStore.findById(
    args.tenant_id,
    args.proposal_id,
  );
  if (!existing) {
    throw new Error(`proposal ${args.proposal_id} not found`);
  }
  if (existing.status === 'declined') return existing;
  if (existing.status !== 'pending_hitl') {
    throw new Error(
      `proposal ${args.proposal_id} cannot be declined from status=${existing.status}`,
    );
  }

  const declined = await args.proposalStore.update(
    args.tenant_id,
    args.proposal_id,
    {
      status: 'declined',
      approver_user_id: args.approver_user_id,
      decline_reason: args.reason,
      resolved_at: now.toISOString(),
    },
  );
  await appendEvent({
    eventLog: args.eventLog,
    newId,
    proposal: declined,
    event_kind: 'proposal_declined',
    actor: `user:${args.approver_user_id}`,
    transport: 'api',
    sequence: 10,
    now,
    notes: args.reason,
  });
  await args.auditSink.append({
    tenant_id: args.tenant_id,
    turn_id: declined.capture_id,
    session_id: null,
    action: 'proposal_declined',
    payload: {
      proposal_id: declined.id,
      approver_user_id: args.approver_user_id,
      reason: args.reason,
    },
  });
  return declined;
}

/**
 * Edit a pending proposal's payload (closes the original and creates
 * a new row linked back via `edited_from_id`). Caller usually pairs
 * this with `approveProposal` on the new row.
 */
export async function editProposal(args: {
  readonly tenant_id: string;
  readonly proposal_id: string;
  readonly editor_user_id: string;
  readonly new_payload: Record<string, unknown>;
  readonly edit_summary: string;
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly auditSink: AuditChainSink;
  readonly eventLog: TabEventLogStore;
  readonly clock?: ClockFn;
  readonly randomId?: RandomIdFn;
}): Promise<ModuleUpdateProposal> {
  const now = args.clock ? args.clock() : new Date();
  const newId = args.randomId ?? randomUUID;

  const original = await args.proposalStore.findById(
    args.tenant_id,
    args.proposal_id,
  );
  if (!original) {
    throw new Error(`proposal ${args.proposal_id} not found`);
  }
  if (original.status !== 'pending_hitl') {
    throw new Error(
      `proposal ${args.proposal_id} cannot be edited from status=${original.status}`,
    );
  }

  // Close the original row.
  await args.proposalStore.update(args.tenant_id, args.proposal_id, {
    status: 'edited',
    approver_user_id: args.editor_user_id,
    resolved_at: now.toISOString(),
  });

  // Create a fresh proposal with the new payload, linking back.
  const editedRow: ModuleUpdateProposal = {
    ...original,
    id: `prop_${newId()}`,
    payload: args.new_payload,
    status: 'pending_hitl',
    edited_from_id: original.id,
    approver_user_id: null,
    approver_tier: null,
    decline_reason: null,
    failure_reason: null,
    resolved_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await args.proposalStore.insert(editedRow);
  await appendEvent({
    eventLog: args.eventLog,
    newId,
    proposal: editedRow,
    event_kind: 'proposal_edited',
    actor: `user:${args.editor_user_id}`,
    transport: 'api',
    sequence: 11,
    now,
    notes: args.edit_summary,
    extraSnapshot: { previous_proposal_id: original.id },
  });
  await args.auditSink.append({
    tenant_id: args.tenant_id,
    turn_id: editedRow.capture_id,
    session_id: null,
    action: 'proposal_edited',
    payload: {
      original_proposal_id: original.id,
      new_proposal_id: editedRow.id,
      editor_user_id: args.editor_user_id,
      edit_summary: args.edit_summary,
    },
  });
  return editedRow;
}

// ─── Internals ─────────────────────────────────────────────────────────

async function createProposalFromMatrixRow(args: {
  readonly capture: ConversationCapture;
  readonly entity: ResolvedEntity;
  readonly row: RoutingMatrixRow;
  readonly persona: PersonaContext;
  readonly now: Date;
  readonly newId: RandomIdFn;
  readonly expiresAt: Date;
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly auditSink: AuditChainSink;
  readonly eventLog: TabEventLogStore;
  readonly sequence: number;
}): Promise<ModuleUpdateProposal> {
  const conf = args.capture.capture_confidence;
  const autoApply =
    !args.row.hitl_required &&
    conf >= args.row.auto_apply_threshold &&
    conf >= GLOBAL_AUTO_APPLY_FLOOR;

  const status = autoApply ? 'auto_applying' : 'pending_hitl';

  // Build payload — minimum viable shape carrying the canonical
  // identifiers + raw text + intent. Handlers extend per action.
  const payload: Record<string, unknown> = {
    primary_entity: {
      type: args.entity.type,
      canonical_id: args.entity.canonical_id,
      raw_value: args.entity.raw_value,
    },
    related_entities: args.capture.entities
      .filter(
        (e) =>
          !(
            e.type === args.entity.type &&
            e.canonical_id === args.entity.canonical_id
          ),
      )
      .map((e) => ({
        type: e.type,
        canonical_id: e.canonical_id,
        raw_value: e.raw_value,
      })),
    user_text: args.capture.user_text,
    assistant_text: args.capture.assistant_text,
    intent: args.capture.intent,
  };

  const proposal: ModuleUpdateProposal = {
    id: `prop_${args.newId()}`,
    tenant_id: args.capture.tenant_id,
    capture_id: args.capture.id,
    module_template_id: args.row.module_template_id,
    action: args.row.action,
    persona_id: args.persona.persona_id,
    status,
    confidence: conf,
    hitl_required: args.row.hitl_required,
    priority: args.row.priority,
    payload,
    entity_refs: args.capture.entities,
    matrix_row_id: args.row.id,
    approver_tier: null,
    approver_user_id: null,
    decline_reason: null,
    edited_from_id: null,
    failure_reason: null,
    resolved_at: null,
    expires_at: args.expiresAt.toISOString(),
    created_at: args.now.toISOString(),
    updated_at: args.now.toISOString(),
  };

  await args.proposalStore.insert(proposal);

  await args.auditSink.append({
    tenant_id: args.capture.tenant_id,
    turn_id: args.capture.id,
    session_id: args.capture.thread_id,
    action: 'proposal_created',
    payload: {
      proposal_id: proposal.id,
      matrix_row_id: args.row.id,
      module_template_id: args.row.module_template_id,
      action: args.row.action,
      status: proposal.status,
      confidence: proposal.confidence,
    },
  });

  await appendEvent({
    eventLog: args.eventLog,
    newId: args.newId,
    proposal,
    event_kind: 'proposal_created',
    actor: 'system',
    transport: 'api',
    sequence: args.sequence,
    now: args.now,
    notes: null,
  });

  // Emit a second event for the specific initial status.
  await appendEvent({
    eventLog: args.eventLog,
    newId: args.newId,
    proposal,
    event_kind:
      status === 'auto_applying'
        ? 'proposal_auto_applied'
        : 'proposal_pending_hitl',
    actor: 'system',
    transport: 'api',
    sequence: args.sequence + 1,
    now: args.now,
    notes: null,
  });

  return proposal;
}

async function invokeHandler(args: {
  readonly proposal: ModuleUpdateProposal;
  readonly tenant_id: string;
  readonly handlerRegistry: AcceptHandlerRegistry;
  readonly proposalStore: ModuleUpdateProposalStore;
  readonly auditSink: AuditChainSink;
  readonly eventLog: TabEventLogStore;
  readonly newId: RandomIdFn;
  readonly clock: Date;
  readonly sequence: number;
}): Promise<void> {
  const handler = args.handlerRegistry.get(
    args.proposal.module_template_id,
    args.proposal.action,
  );
  if (!handler) {
    await args.proposalStore.update(args.tenant_id, args.proposal.id, {
      status: 'failed',
      failure_reason: `no handler for ${args.proposal.module_template_id}.${args.proposal.action}`,
      resolved_at: args.clock.toISOString(),
    });
    return;
  }
  const result = await handler({
    tenant_id: args.tenant_id,
    proposal: args.proposal,
  });
  if (result.ok) {
    await args.proposalStore.update(args.tenant_id, args.proposal.id, {
      status: 'accepted',
      resolved_at: args.clock.toISOString(),
      approver_user_id: 'system_auto_apply',
    });
    await args.auditSink.append({
      tenant_id: args.tenant_id,
      turn_id: args.proposal.capture_id,
      session_id: null,
      action: 'proposal_accepted_auto',
      payload: {
        proposal_id: args.proposal.id,
        artifacts: result.artifacts ?? [],
      },
    });
  } else {
    await args.proposalStore.update(args.tenant_id, args.proposal.id, {
      status: 'failed',
      failure_reason: result.error ?? 'auto-apply failed',
      resolved_at: args.clock.toISOString(),
    });
    await args.auditSink.append({
      tenant_id: args.tenant_id,
      turn_id: args.proposal.capture_id,
      session_id: null,
      action: 'proposal_failed',
      payload: {
        proposal_id: args.proposal.id,
        error: result.error ?? null,
      },
    });
  }
}

function matrixRowMatches(
  row: RoutingMatrixRow,
  entity: ResolvedEntity,
  capture: ConversationCapture,
  persona: PersonaContext,
): boolean {
  if (row.entity_type !== entity.type) return false;
  if (row.intent !== capture.intent) return false;
  if (capture.capture_confidence < row.min_confidence) return false;
  if (
    row.jurisdiction !== '*' &&
    persona.jurisdiction &&
    persona.jurisdiction !== row.jurisdiction
  ) {
    return false;
  }
  if (row.tenant_scope !== '*' && row.tenant_scope !== capture.tenant_id) {
    return false;
  }
  return true;
}

async function appendEvent(args: {
  readonly eventLog: TabEventLogStore;
  readonly newId: RandomIdFn;
  readonly proposal: ModuleUpdateProposal;
  readonly event_kind: TabEventKind;
  readonly actor: string;
  readonly transport: string;
  readonly sequence: number;
  readonly now: Date;
  readonly notes: string | null;
  readonly extraSnapshot?: Record<string, unknown>;
}): Promise<void> {
  const evt: TabEventLogEntry = {
    id: `evt_${args.newId()}`,
    tenant_id: args.proposal.tenant_id,
    capture_id: args.proposal.capture_id,
    proposal_id: args.proposal.id,
    module_template_id: args.proposal.module_template_id,
    persona_id: args.proposal.persona_id,
    event_kind: args.event_kind,
    actor: args.actor,
    transport: args.transport,
    snapshot: {
      proposal_id: args.proposal.id,
      status: args.proposal.status,
      ...(args.extraSnapshot ?? {}),
    },
    notes: args.notes,
    sequence: args.sequence,
    created_at: args.now.toISOString(),
  };
  await args.eventLog.append(evt);
}
