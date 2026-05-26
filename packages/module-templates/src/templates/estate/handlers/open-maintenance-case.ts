/**
 * estate / open_maintenance_case — file a maintenance ticket against a unit.
 *
 * Triggered by:
 *   - kernel turn  : "the bathroom tap in unit 4B is leaking"
 *                    (intent=propose_action, entity=unit + raw maintenance signal)
 *   - document     : an inspection report or complaint letter (Piece K)
 *
 * Writes to `maintenance_tickets` if the migration has landed; otherwise
 * logs a TODO(#34) warning so an integration test can still verify the
 * handler's CALL SHAPE.
 */

import { z } from 'zod';
import { logger } from '../../../logger.js';

// ─── Payload schema ───────────────────────────────────────────────────────

export const OpenMaintenanceCasePayloadSchema = z.object({
  /** Unit (core_entity id) where the maintenance is needed. */
  unit_id: z.string().min(1),
  /** Short one-line summary (will be the ticket title). */
  summary: z.string().min(3),
  /** Categorisation taxonomy — keeps the brain's analytics consistent. */
  category: z.enum([
    'plumbing',
    'electrical',
    'structural',
    'appliance',
    'cosmetic',
    'security',
    'other',
  ]),
  /** Severity at which the ticket opens — informs SLA timer. */
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  /** Free-text body (full description if available). */
  description: z.string().nullable(),
  /** Reporter (canonical PERSON entity); may be the tenant or a manager. */
  reporter_entity_id: z.string().nullable(),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type OpenMaintenanceCasePayload = z.infer<
  typeof OpenMaintenanceCasePayloadSchema
>;

export interface OpenMaintenanceCaseResult {
  readonly ticket_id: string;
  readonly audit_chain_id: string;
  readonly status: 'open';
  /** True if write went to the real table; false when stubbed via console.warn. */
  readonly persisted: boolean;
}

// ─── Ports ────────────────────────────────────────────────────────────────

export interface MaintenanceTicketStorePort {
  /**
   * Returns `null` when the underlying table does not yet exist.
   * Production implementation queries `pg_tables` once at startup and
   * caches the result — the handler then logs a TODO(#34) warning instead.
   */
  open(args: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly summary: string;
    readonly category: string;
    readonly severity: string;
    readonly description: string | null;
    readonly reporterEntityId: string | null;
  }): Promise<{ readonly id: string } | null>;
}

export interface AuditChainPort {
  append(args: {
    readonly tenantId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface NotificationPort {
  publish(args: {
    readonly tenantId: string;
    readonly channel: string;
    readonly subject: string;
    readonly correlation: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface OpenMaintenanceCaseDeps {
  readonly tickets: MaintenanceTicketStorePort;
  readonly auditChain: AuditChainPort;
  readonly notifications: NotificationPort;
  /** Optional logger so the stub-warn is testable in production. */
  readonly logger?: {
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface OpenMaintenanceCaseContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function openMaintenanceCaseHandler(
  payload: OpenMaintenanceCasePayload,
  ctx: OpenMaintenanceCaseContext,
  deps: OpenMaintenanceCaseDeps,
): Promise<OpenMaintenanceCaseResult> {
  // 1. Validate.
  const parsed = OpenMaintenanceCasePayloadSchema.parse(payload);

  // 2. Try to persist. Returns null when table missing.
  const ticket = await deps.tickets.open({
    tenantId: ctx.tenantId,
    unitId: parsed.unit_id,
    summary: parsed.summary,
    category: parsed.category,
    severity: parsed.severity,
    description: parsed.description,
    reporterEntityId: parsed.reporter_entity_id,
  });

  // 3. Fallback when the migration hasn't landed yet.
  let ticketId: string;
  let persisted: boolean;
  if (ticket === null) {
    ticketId = `stub_ticket_${ctx.proposalId}`;
    persisted = false;
    if (deps.logger?.warn) {
      deps.logger.warn(
        { proposal_id: ctx.proposalId, unit_id: parsed.unit_id },
        'TODO(#34): write to maintenance_tickets table when migration lands',
      );
    } else {
      logger.warn('TODO(#34): write to maintenance_tickets table when migration lands', { proposal_id: ctx.proposalId, unit_id: parsed.unit_id });
    }
  } else {
    ticketId = ticket.id;
    persisted = true;
  }

  // 4. Audit chain.
  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'estate.open_maintenance_case',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      ticket_id: ticketId,
      unit_id: parsed.unit_id,
      category: parsed.category,
      severity: parsed.severity,
      persisted,
    },
  });

  // 5. Notify the manager on the ESTATE channel.
  await deps.notifications.publish({
    tenantId: ctx.tenantId,
    channel: `tenant:${ctx.tenantId}:module:ESTATE:maintenance`,
    subject: `Maintenance ticket opened for unit ${parsed.unit_id}`,
    correlation: {
      ticket_id: ticketId,
      proposal_id: ctx.proposalId,
      category: parsed.category,
      severity: parsed.severity,
    },
  });

  return Object.freeze({
    ticket_id: ticketId,
    audit_chain_id: audit.id,
    status: 'open' as const,
    persisted,
  });
}
