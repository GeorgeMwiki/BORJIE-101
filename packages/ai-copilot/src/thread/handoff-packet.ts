/**
 * Handoff Packet
 *
 * The structured artifact passed between personae when the orchestrator
 * delegates work. Required by design rule #4: "Handoff between personae =
 * HandoffPacket, never a bare trailing message."
 *
 * Directly addresses the Cognition failure mode — sub-agents lose context
 * when handed only a final message. The HandoffPacket carries the decision
 * trail so the receiving persona can see *why* it's being asked to act,
 * *what* has already been ruled in/out, and *which* constraints bind it.
 *
 * Zod-validated at every boundary. Violations are governance events, not
 * silent failures.
 */

import { z } from 'zod';
import { VisibilityLabel, VisibilityLabelSchema } from './visibility.js';

export interface HandoffConstraint {
  /** Short machine id, e.g. `no_rent_change_without_owner_approval`. */
  id: string;
  /** Human-readable statement of the constraint. */
  statement: string;
  /** Source of the constraint (policy, regulation, admin instruction). */
  source: 'policy' | 'regulation' | 'admin' | 'tenant_setting' | 'derived';
}

export interface HandoffDecision {
  /** Short decision label. */
  label: string;
  /** Who/what decided it (persona id or user id). */
  decidedBy: string;
  /** Timestamp. */
  decidedAt: string;
  /** One-line rationale. */
  rationale: string;
}

export interface HandoffEntityRef {
  /** Entity kind — property, unit, lease, tenant, work_order, etc. */
  kind: string;
  /** Entity id in the Canonical Property Graph / Postgres. */
  id: string;
  /** Short label for UI/context rendering. */
  label?: string;
}

export interface HandoffPacket {
  /** Packet id for tracing. */
  id: string;
  /** Thread the packet belongs to. */
  threadId: string;
  /** Persona id being delegated to. */
  targetPersonaId: string;
  /** Persona id that is delegating. */
  sourcePersonaId: string;

  /** The unit of work being asked for. */
  objective: string;
  /** Structured output format the receiving persona must return. */
  outputFormat: string;

  /** Entities already resolved and relevant. */
  relevantEntities: HandoffEntityRef[];
  /** Decisions that have already been made (ruled in / ruled out). */
  priorDecisions: HandoffDecision[];
  /** Constraints that bind the receiving persona. */
  constraints: HandoffConstraint[];
  /** Tool subset the receiving persona is permitted to use. */
  allowedTools: string[];

  /** Summary of the conversation so far — compressed, not raw. */
  contextSummary: string;
  /** The *latest* user message text (for direct quoting if needed). */
  latestUserMessage?: string;

  /** Visibility budget: receiver cannot exceed this. */
  visibility: VisibilityLabel;

  /** Token accounting so far in this turn. */
  tokensSoFar: number;
  /** Max tokens the receiver may spend in its response. */
  tokenBudget: number;

  /** Creation timestamp. */
  createdAt: string;
}

/**
 * Zod schema — runtime-validated at every orchestrator boundary.
 */
export const HandoffEntityRefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
});

export const HandoffDecisionSchema = z.object({
  label: z.string().min(1),
  decidedBy: z.string().min(1),
  decidedAt: z.string().min(1),
  rationale: z.string(),
});

export const HandoffConstraintSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  source: z.enum(['policy', 'regulation', 'admin', 'tenant_setting', 'derived']),
});

export const HandoffPacketSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  targetPersonaId: z.string().min(1),
  sourcePersonaId: z.string().min(1),
  objective: z.string().min(1).max(2_000),
  outputFormat: z.string().min(1).max(2_000),
  relevantEntities: z.array(HandoffEntityRefSchema),
  priorDecisions: z.array(HandoffDecisionSchema),
  constraints: z.array(HandoffConstraintSchema),
  allowedTools: z.array(z.string()),
  contextSummary: z.string().max(10_000),
  latestUserMessage: z.string().optional(),
  visibility: VisibilityLabelSchema,
  tokensSoFar: z.number().int().nonnegative(),
  tokenBudget: z.number().int().positive(),
  createdAt: z.string().min(1),
});

/**
 * Render a HandoffPacket as a string suitable for injection into the
 * receiving persona's system / user prompt. Keep format stable: the
 * receiving persona is trained to parse it.
 */
export function renderHandoffPacket(p: HandoffPacket): string {
  const entities = p.relevantEntities.length
    ? p.relevantEntities
        .map((e) => `- ${e.kind}:${e.id}${e.label ? ` (${e.label})` : ''}`)
        .join('\n')
    : '- (none)';
  const decisions = p.priorDecisions.length
    ? p.priorDecisions
        .map((d) => `- [${d.decidedBy} @ ${d.decidedAt}] ${d.label} — ${d.rationale}`)
        .join('\n')
    : '- (none)';
  const constraints = p.constraints.length
    ? p.constraints
        .map((c) => `- (${c.source}) ${c.id}: ${c.statement}`)
        .join('\n')
    : '- (none)';
  const tools = p.allowedTools.length
    ? p.allowedTools.map((t) => `- ${t}`).join('\n')
    : '- (none — read-only context only)';

  return [
    '=== HANDOFF PACKET ===',
    `Thread: ${p.threadId}`,
    `From: ${p.sourcePersonaId}`,
    `To:   ${p.targetPersonaId}`,
    '',
    `Visibility scope: ${p.visibility.scope}`,
    `Token budget: ${p.tokenBudget} (used so far in turn: ${p.tokensSoFar})`,
    '',
    'Objective:',
    p.objective,
    '',
    'Required output format:',
    p.outputFormat,
    '',
    'Relevant entities:',
    entities,
    '',
    'Prior decisions (do not revisit unless you have new evidence):',
    decisions,
    '',
    'Constraints (binding):',
    constraints,
    '',
    'Allowed tools:',
    tools,
    '',
    'Context summary:',
    p.contextSummary || '(none)',
    p.latestUserMessage
      ? `\nLatest user message (verbatim):\n"""\n${p.latestUserMessage}\n"""`
      : '',
    '=== END PACKET ===',
  ].join('\n');
}

/**
 * Validate + parse an unknown value as a HandoffPacket.
 * Returns null on failure; callers must route null to governance as a
 * contract-violation audit event.
 */
export function parseHandoffPacket(value: unknown): HandoffPacket | null {
  const result = HandoffPacketSchema.safeParse(value);
  return result.success ? (result.data as HandoffPacket) : null;
}
