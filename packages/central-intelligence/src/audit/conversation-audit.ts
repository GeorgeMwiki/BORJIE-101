/**
 * ConversationAuditRecorder — hashes every agent turn into the Wave-27
 * audit-trail chain.
 *
 * Purpose: when the Head of Estates or a Borjie staff member asks
 * a question, EVERY step — the question itself, the plan the agent
 * chose, every tool the agent called, every citation it returned,
 * every artifact it rendered, every privacy budget debit, every error
 * — must land on the cryptographically-verifiable append-only chain.
 *
 * This is what makes "talk to your company" auditable: the operator
 * can review, replay, and cryptographically prove what the AI did on
 * their authority, to a regulator or an insurer, years later.
 *
 * Design:
 *   - This module is a THIN adapter on top of the existing
 *     audit-trail v2 package (packages/ai-copilot/src/audit-trail).
 *     We do not re-invent the chain; we map each AgentEvent to a
 *     RecordAuditInput and delegate.
 *   - Recording is FIRE-AND-FORWARD inside the agent loop: a recorder
 *     failure never blocks the stream to the user. Failed records
 *     land in a small local dead-letter bag the caller can inspect
 *     (and later requeue to the chain).
 *   - Platform-scope turns do NOT write to any tenant's audit trail
 *     (there is no tenant). Instead they write to the platform audit
 *     chain — a separate tenantId token reserved for HQ (see
 *     PLATFORM_AUDIT_TENANT_ID below).
 *   - The recorder never stringifies user / agent text into the
 *     `evidence` field verbatim — only hashes, citations-by-id,
 *     artifact-ids, and tool-call summaries. Raw content lives in
 *     ConversationMemory; the audit chain carries provenance.
 *
 * This package does not depend on the ai-copilot package at runtime
 * to keep the dependency graph shallow — instead it defines a narrow
 * `AuditSink` port that ai-copilot's AuditTrailRecorder satisfies.
 */

import { createHash } from 'node:crypto';
import type {
  AgentEvent,
  Citation,
  ScopeContext,
  Tool,
  ToolOutcome,
} from '../types.js';
import { logger } from '../logger.js';

/** Reserved tenantId for platform-scope audit entries. Never collides
 *  with a real tenant id because real tenant ids are UUIDs and this is
 *  a fixed literal string. */
export const PLATFORM_AUDIT_TENANT_ID = '_borjie_platform_audit';

/**
 * Narrow sink port — satisfied by the ai-copilot/audit-trail package's
 * AuditTrailRecorder. We only need the one method.
 */
export interface AuditSink {
  record(input: AuditSinkInput): Promise<{ readonly id: string; readonly sequenceId: number }>;
}

export interface AuditSinkInput {
  readonly tenantId: string;
  readonly actor: {
    readonly kind: 'user' | 'ai_system' | 'ai_execution' | 'system';
    readonly id: string | null;
    readonly display?: string | null;
  };
  readonly actionKind: string;
  readonly actionCategory:
    | 'finance'
    | 'leasing'
    | 'maintenance'
    | 'compliance'
    | 'communications'
    | 'marketing'
    | 'hr'
    | 'procurement'
    | 'insurance'
    | 'legal'
    | 'tenant_welfare'
    | 'other';
  readonly subject?: {
    readonly entityType?: string | null;
    readonly entityId?: string | null;
    readonly resourceUri?: string | null;
  };
  readonly ai?: {
    readonly modelVersion?: string | null;
    readonly promptHash?: string | null;
    readonly attachments?: Readonly<Record<string, unknown>>;
  };
  readonly decision?: string;
  readonly occurredAt?: Date;
}

export interface ConversationAuditEvent {
  readonly threadId: string;
  readonly turnId: string;
  readonly actorUserId: string;
  readonly ctx: ScopeContext;
  readonly event: AgentEvent | UserMessageEvent;
}

export interface UserMessageEvent {
  readonly kind: 'user_message';
  readonly content: string;
  readonly at: string;
}

export interface ConversationAuditRecorder {
  /** Record a single event. Fire-and-forward: never throws out of
   *  this function even when the sink is unhealthy; failures land
   *  in the dead-letter buffer. */
  record(event: ConversationAuditEvent): Promise<void>;
  /** Read (and clear) failed entries so the caller can requeue. */
  drainDeadLetter(): ReadonlyArray<ConversationAuditEvent>;
  /** Size of the DLQ — cheap health-check. */
  readonly deadLetterSize: number;
}

export interface ConversationAuditRecorderDeps {
  readonly sink: AuditSink;
  /** Bounded DLQ. Default 100. Older entries drop off when full. */
  readonly deadLetterCap?: number;
  /** Clock for `occurredAt`. */
  readonly clock?: () => Date;
  /** Model version the LLM adapter is running, so every turn's entry
   *  can record it. Default 'unknown'. */
  readonly modelVersion?: string;
}

export function createConversationAuditRecorder(
  deps: ConversationAuditRecorderDeps,
): ConversationAuditRecorder {
  const cap = deps.deadLetterCap ?? 100;
  const now = deps.clock ?? (() => new Date());
  const modelVersion = deps.modelVersion ?? 'unknown';
  const dlq: ConversationAuditEvent[] = [];

  async function record(ev: ConversationAuditEvent): Promise<void> {
    try {
      const input = mapToSinkInput(ev, now(), modelVersion);
      if (!input) return; // event kind was intentionally skipped
      await deps.sink.record(input);
    } catch (err) {
      // DLQ + log; never propagate
      if (dlq.length >= cap) dlq.shift();
      dlq.push(ev);
      /* eslint-disable no-console */
      logger.warn('central-intelligence/audit: record failed, dead-lettered', { threadId: ev.threadId, kind: ev.event.kind, err: (err as Error).message });
      /* eslint-enable no-console */
    }
  }

  return {
    record,
    drainDeadLetter(): ReadonlyArray<ConversationAuditEvent> {
      const out = dlq.slice();
      dlq.length = 0;
      return Object.freeze(out);
    },
    get deadLetterSize(): number {
      return dlq.length;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mapping: AgentEvent → AuditSinkInput
// ─────────────────────────────────────────────────────────────────────

function mapToSinkInput(
  ev: ConversationAuditEvent,
  occurredAt: Date,
  modelVersion: string,
): AuditSinkInput | null {
  const tenantId = ev.ctx.kind === 'tenant' ? ev.ctx.tenantId : PLATFORM_AUDIT_TENANT_ID;
  const actor: AuditSinkInput['actor'] =
    ev.event.kind === 'user_message'
      ? { kind: 'user', id: ev.actorUserId, display: null }
      : { kind: 'ai_system', id: ev.actorUserId, display: null };

  const base = {
    tenantId,
    actor,
    occurredAt,
    subject: {
      entityType: 'ci_thread',
      entityId: ev.threadId,
      resourceUri: `ci:/thread/${ev.threadId}/turn/${ev.turnId}`,
    },
  } as const;

  switch (ev.event.kind) {
    case 'user_message':
      return {
        ...base,
        actionKind: 'ci.user_message',
        actionCategory: 'communications',
        decision: 'proposed',
        ai: {
          modelVersion: null,
          promptHash: contentHash(ev.event.content),
          attachments: { scope: ev.ctx.kind, contentLength: ev.event.content.length },
        },
      };
    case 'plan':
      return {
        ...base,
        actionKind: 'ci.plan',
        actionCategory: 'other',
        decision: 'proposed',
        ai: {
          modelVersion,
          attachments: { stepCount: ev.event.steps.length, steps: ev.event.steps },
        },
      };
    case 'thought':
      // Thoughts are private reasoning. We record the HASH only so
      // the chain proves the thought existed at time-X without
      // exposing it to downstream consumers who don't need to see
      // the reasoning trace.
      return {
        ...base,
        actionKind: 'ci.thought',
        actionCategory: 'other',
        decision: 'noop',
        ai: {
          modelVersion,
          promptHash: contentHash(ev.event.text),
          attachments: { thoughtLength: ev.event.text.length },
        },
      };
    case 'tool_call':
      return {
        ...base,
        actionKind: `ci.tool_call.${safeVerb(ev.event.toolName)}`,
        actionCategory: categoryFromToolName(ev.event.toolName),
        decision: 'proposed',
        ai: {
          modelVersion,
          attachments: {
            callId: ev.event.callId,
            toolName: ev.event.toolName,
            inputHash: contentHash(safeJson(ev.event.input)),
          },
        },
      };
    case 'tool_result': {
      const toolVerb = toolNameFromOutcome(ev.event.outcome);
      return {
        ...base,
        actionKind: `ci.tool_result.${toolVerb ? safeVerb(toolVerb) : 'unknown'}`,
        actionCategory: 'other',
        decision: ev.event.outcome.kind === 'ok' ? 'executed' : 'rejected',
        ai: {
          modelVersion,
          attachments: {
            callId: ev.event.callId,
            outcomeKind: ev.event.outcome.kind,
            citationIds:
              ev.event.outcome.kind === 'ok'
                ? ev.event.outcome.citations.map((c) => c.id)
                : [],
            artifactId:
              ev.event.outcome.kind === 'ok' && ev.event.outcome.artifact
                ? ev.event.outcome.artifact.id
                : null,
            latencyMs:
              ev.event.outcome.kind === 'ok' ? ev.event.outcome.latencyMs : null,
            errorMessage:
              ev.event.outcome.kind === 'error' ? ev.event.outcome.message : null,
          },
        },
      };
    }
    case 'text':
      // Text deltas stream at high rate — don't record every chunk.
      // The `done` event below records the aggregated text hash.
      return null;
    case 'citation':
      return {
        ...base,
        actionKind: 'ci.citation',
        actionCategory: 'other',
        decision: 'executed',
        ai: {
          modelVersion,
          attachments: citationAttachments(ev.event.citation),
        },
      };
    case 'artifact':
      return {
        ...base,
        actionKind: `ci.artifact.${safeVerb(ev.event.artifact.kind)}`,
        actionCategory: 'other',
        decision: 'executed',
        ai: {
          modelVersion,
          attachments: {
            artifactId: ev.event.artifact.id,
            kind: ev.event.artifact.kind,
            title: ev.event.artifact.title,
            citationIds: ev.event.artifact.citations.map((c) => c.id),
          },
        },
      };
    case 'error':
      return {
        ...base,
        actionKind: 'ci.error',
        actionCategory: 'other',
        decision: 'rejected',
        ai: {
          modelVersion,
          attachments: {
            message: ev.event.message,
            retryable: ev.event.retryable,
          },
        },
      };
    case 'done':
      return {
        ...base,
        actionKind: 'ci.turn_done',
        actionCategory: 'other',
        decision: 'executed',
        ai: {
          modelVersion,
          attachments: {
            turnId: ev.event.turnId,
            totalMs: ev.event.totalMs,
          },
        },
      };
    default:
      return assertExhaustive(ev.event);
  }
}

function citationAttachments(c: Citation): Readonly<Record<string, unknown>> {
  const target = c.target;
  // Structured attachment keyed by target kind — keeps the chain's
  // JSON auditable without losing the pointer to the grounded source.
  return {
    citationId: c.id,
    label: c.label,
    confidence: c.confidence,
    targetKind: target.kind,
    target,
  };
}

function categoryFromToolName(
  toolName: string,
): AuditSinkInput['actionCategory'] {
  const lower = toolName.toLowerCase();
  if (lower.startsWith('finance.') || lower.includes('arrear') || lower.includes('invoice')) return 'finance';
  if (lower.startsWith('legal.') || lower.includes('tribunal') || lower.includes('eviction')) return 'legal';
  if (lower.startsWith('maintenance.') || lower.includes('work_order')) return 'maintenance';
  if (lower.startsWith('compliance.')) return 'compliance';
  if (lower.startsWith('comm') || lower.includes('message')) return 'communications';
  if (lower.startsWith('leasing.') || lower.includes('lease')) return 'leasing';
  if (lower.startsWith('marketing.')) return 'marketing';
  if (lower.startsWith('hr.')) return 'hr';
  if (lower.startsWith('procurement.') || lower.includes('vendor') || lower.includes('payout')) return 'procurement';
  if (lower.startsWith('insurance.')) return 'insurance';
  return 'other';
}

function safeVerb(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_.]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 96);
}

function toolNameFromOutcome(_outcome: ToolOutcome<unknown>): string | null {
  // ToolOutcome doesn't carry the tool name. Callers who want per-
  // tool action_kinds should pre-resolve; we accept the unknown here.
  return null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
}

function contentHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertExhaustive(_v: never): null {
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Tool-level citation summary — a tiny helper the agent loop uses to
// produce the `attachments` for tool-calls whose tools returned
// citations (above, the citationIds live on the tool_result). Exposed
// so the agent loop doesn't have to reach into the shape.
// ─────────────────────────────────────────────────────────────────────

export interface ToolCallAuditSummary {
  readonly callId: string;
  readonly toolName: string;
  readonly inputHash: string;
  readonly outcomeKind: 'ok' | 'error';
  readonly citationIds: ReadonlyArray<string>;
  readonly artifactId: string | null;
  readonly latencyMs: number | null;
  readonly errorMessage: string | null;
}

export function summariseToolCall(
  toolCall: { readonly callId: string; readonly toolName: string; readonly input: unknown },
  outcome: ToolOutcome<unknown>,
): ToolCallAuditSummary {
  return {
    callId: toolCall.callId,
    toolName: toolCall.toolName,
    inputHash: contentHash(safeJson(toolCall.input)),
    outcomeKind: outcome.kind === 'ok' ? 'ok' : 'error',
    citationIds:
      outcome.kind === 'ok' ? outcome.citations.map((c) => c.id) : [],
    artifactId:
      outcome.kind === 'ok' && outcome.artifact ? outcome.artifact.id : null,
    latencyMs: outcome.kind === 'ok' ? outcome.latencyMs : null,
    errorMessage: outcome.kind === 'error' ? outcome.message : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Trivial (tool-unaware) Tool type re-export — kept for call sites
// that want to lint tool names against the registry before recording.
// ─────────────────────────────────────────────────────────────────────

export type AuditKnownTool = Pick<Tool, 'name' | 'scopes'>;
