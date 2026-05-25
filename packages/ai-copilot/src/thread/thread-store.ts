/**
 * Thread Store
 *
 * The conversation is the primary memory surface for the Brain. Every turn —
 * user message, persona response, tool call, handoff packet, governance event
 * — is appended to a Thread. Personae read filtered views of the thread;
 * they never have private memory.
 *
 * This module defines the in-memory implementation and the storage contract.
 * Production will plug in a Postgres-backed implementation (see
 * `packages/database/src/schemas/conversation.schema.ts`), but the contract
 * is the same.
 *
 * Design constraints from Cognition's "share context, share full traces":
 *  - Readers always get the FULL relevant trace (subject to visibility).
 *  - Messages are append-only; edits become new events referencing old ones.
 *  - Every event carries a VisibilityLabel.
 */

import { z } from 'zod';
import {
  VisibilityLabel,
  VisibilityLabelSchema,
  VisibilityViewer,
  filterVisible,
} from './visibility.js';
import { HandoffPacket, HandoffPacketSchema } from './handoff-packet.js';

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export const ThreadEventKind = {
  USER_MESSAGE: 'user_message',
  PERSONA_MESSAGE: 'persona_message',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  HANDOFF_OUT: 'handoff_out',
  HANDOFF_IN: 'handoff_in',
  REVIEW_REQUESTED: 'review_requested',
  REVIEW_DECISION: 'review_decision',
  SYSTEM_NOTE: 'system_note',
} as const;

export type ThreadEventKind =
  (typeof ThreadEventKind)[keyof typeof ThreadEventKind];

export interface BaseThreadEvent {
  id: string;
  threadId: string;
  kind: ThreadEventKind;
  createdAt: string;
  visibility: VisibilityLabel;
  /** Actor (user or persona) that produced the event. */
  actorId: string;
  /** Optional parent event id for edits / replies. */
  parentEventId?: string;
}

export interface UserMessageEvent extends BaseThreadEvent {
  kind: 'user_message';
  text: string;
  /** Optional attachments — file ids managed by document-intelligence. */
  attachments?: Array<{ id: string; name: string; mime?: string }>;
}

export interface PersonaMessageEvent extends BaseThreadEvent {
  kind: 'persona_message';
  personaId: string;
  text: string;
  /** Advisor consulted? (set iff Advisor pattern was used). */
  advisorConsulted?: boolean;
  /** Citations to entities / documents supporting the claim. */
  citations?: Array<{ kind: string; id: string; label?: string }>;
  /** Confidence score 0-1 if the persona self-reported one. */
  confidence?: number;
}

export interface ToolCallEvent extends BaseThreadEvent {
  kind: 'tool_call';
  personaId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseThreadEvent {
  kind: 'tool_result';
  personaId: string;
  toolName: string;
  /** Full result — keep raw so downstream personae see the evidence. */
  result: unknown;
  /** Short evidence summary for compression-friendly rendering. */
  evidenceSummary?: string;
  /** Whether the tool call succeeded. */
  ok: boolean;
  executionTimeMs?: number;
}

export interface HandoffOutEvent extends BaseThreadEvent {
  kind: 'handoff_out';
  packet: HandoffPacket;
}

export interface HandoffInEvent extends BaseThreadEvent {
  kind: 'handoff_in';
  packetId: string;
  acceptedBy: string;
}

export interface ReviewRequestedEvent extends BaseThreadEvent {
  kind: 'review_requested';
  personaId: string;
  copilotRequestId: string;
  riskLevel: string;
}

export interface ReviewDecisionEvent extends BaseThreadEvent {
  kind: 'review_decision';
  copilotRequestId: string;
  decision: 'approved' | 'rejected' | 'modified';
  reviewerId: string;
  feedback?: string;
}

export interface SystemNoteEvent extends BaseThreadEvent {
  kind: 'system_note';
  text: string;
  /** Kind of note — useful for filtering. */
  noteKind: 'governance' | 'error' | 'info' | 'compaction';
}

export type ThreadEvent =
  | UserMessageEvent
  | PersonaMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | HandoffOutEvent
  | HandoffInEvent
  | ReviewRequestedEvent
  | ReviewDecisionEvent
  | SystemNoteEvent;

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  tenantId: string;
  /** Primary human who started the thread. */
  initiatingUserId: string;
  /** Primary persona handling the thread (may change via handoff). */
  primaryPersonaId: string;
  /** Optional team binding (for Junior/Coworker threads). */
  teamId?: string;
  /** Optional employee binding (for Coworker threads). */
  employeeId?: string;
  /** Short title shown in the sidebar. */
  title: string;
  /** Open, resolved, or archived. */
  status: 'open' | 'resolved' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage backend contract
// ---------------------------------------------------------------------------

export interface ThreadStoreBackend {
  createThread(thread: Omit<Thread, 'createdAt' | 'updatedAt'>): Promise<Thread>;
  getThread(threadId: string): Promise<Thread | null>;
  listThreads(tenantId: string, opts?: ListThreadsOptions): Promise<Thread[]>;
  appendEvent(event: ThreadEvent): Promise<void>;
  listEvents(threadId: string): Promise<ThreadEvent[]>;
  /** Archive thread — soft delete, NOT hard delete. */
  archiveThread(threadId: string): Promise<void>;
}

export interface ListThreadsOptions {
  userId?: string;
  teamId?: string;
  employeeId?: string;
  personaId?: string;
  status?: Thread['status'];
  limit?: number;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export class InMemoryThreadStore implements ThreadStoreBackend {
  private threads = new Map<string, Thread>();
  private events = new Map<string, ThreadEvent[]>();

  async createThread(
    input: Omit<Thread, 'createdAt' | 'updatedAt'>
  ): Promise<Thread> {
    const now = new Date().toISOString();
    const thread: Thread = { ...input, createdAt: now, updatedAt: now };
    this.threads.set(thread.id, thread);
    this.events.set(thread.id, []);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return this.threads.get(threadId) ?? null;
  }

  async listThreads(
    tenantId: string,
    opts: ListThreadsOptions = {}
  ): Promise<Thread[]> {
    const result: Thread[] = [];
    for (const t of this.threads.values()) {
      if (t.tenantId !== tenantId) continue;
      if (opts.userId && t.initiatingUserId !== opts.userId) continue;
      if (opts.teamId && t.teamId !== opts.teamId) continue;
      if (opts.employeeId && t.employeeId !== opts.employeeId) continue;
      if (opts.personaId && t.primaryPersonaId !== opts.personaId) continue;
      if (opts.status && t.status !== opts.status) continue;
      result.push(t);
    }
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return opts.limit ? result.slice(0, opts.limit) : result;
  }

  async appendEvent(event: ThreadEvent): Promise<void> {
    const list = this.events.get(event.threadId);
    if (!list) {
      throw new Error(`Thread not found: ${event.threadId}`);
    }
    list.push(event);
    const t = this.threads.get(event.threadId);
    if (t) {
      t.updatedAt = event.createdAt;
      this.threads.set(t.id, t);
    }
  }

  async listEvents(threadId: string): Promise<ThreadEvent[]> {
    return [...(this.events.get(threadId) ?? [])];
  }

  async archiveThread(threadId: string): Promise<void> {
    const t = this.threads.get(threadId);
    if (t) {
      t.status = 'archived';
      t.updatedAt = new Date().toISOString();
      this.threads.set(threadId, t);
    }
  }
}

// ---------------------------------------------------------------------------
// ThreadStore facade with visibility-filtered reads
// ---------------------------------------------------------------------------

export class ThreadStore {
  constructor(private readonly backend: ThreadStoreBackend) {}

  async createThread(
    input: Omit<Thread, 'createdAt' | 'updatedAt'>
  ): Promise<Thread> {
    return this.backend.createThread(input);
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return this.backend.getThread(threadId);
  }

  async listThreads(
    tenantId: string,
    opts?: ListThreadsOptions
  ): Promise<Thread[]> {
    return this.backend.listThreads(tenantId, opts);
  }

  async archiveThread(threadId: string): Promise<void> {
    return this.backend.archiveThread(threadId);
  }

  /**
   * Append an event to a thread. Validates visibility + (for handoff events)
   * the packet schema. Rejects malformed input — the Orchestrator logs this
   * as a governance audit event.
   */
  async append(event: ThreadEvent): Promise<void> {
    const visResult = VisibilityLabelSchema.safeParse(event.visibility);
    if (!visResult.success) {
      throw new Error(
        `Invalid visibility label on thread event: ${visResult.error.message}`
      );
    }
    if (event.kind === 'handoff_out') {
      const p = HandoffPacketSchema.safeParse(event.packet);
      if (!p.success) {
        throw new Error(
          `Invalid HandoffPacket on handoff_out event: ${p.error.message}`
        );
      }
    }
    return this.backend.appendEvent(event);
  }

  /**
   * Read the thread as the given viewer. Returns only events the viewer is
   * authorized to see.
   */
  async readAs(threadId: string, viewer: VisibilityViewer): Promise<ThreadEvent[]> {
    const all = await this.backend.listEvents(threadId);
    return filterVisible(all, viewer);
  }

  /**
   * Read the full thread — SYSTEM path only. Used by the orchestrator when
   * constructing persona context; the orchestrator itself is trusted and
   * enforces visibility to downstream consumers.
   */
  async readFull(threadId: string): Promise<ThreadEvent[]> {
    return this.backend.listEvents(threadId);
  }

  /**
   * Produce a condensed textual context suitable for injection into a persona
   * prompt. Honors visibility, honors max-event cap, and collapses
   * tool_call + tool_result pairs.
   */
  async renderContextAs(
    threadId: string,
    viewer: VisibilityViewer,
    opts: { maxEvents?: number; sinceIso?: string } = {}
  ): Promise<string> {
    const all = await this.readAs(threadId, viewer);
    const since = opts.sinceIso
      ? all.filter((e) => e.createdAt >= opts.sinceIso!)
      : all;
    const capped = opts.maxEvents ? since.slice(-opts.maxEvents) : since;

    const lines: string[] = [];
    for (const e of capped) {
      switch (e.kind) {
        case 'user_message':
          lines.push(`[user] ${e.text}`);
          break;
        case 'persona_message':
          lines.push(
            `[${e.personaId}${e.advisorConsulted ? '+advisor' : ''}] ${e.text}`
          );
          break;
        case 'tool_call':
          lines.push(
            `[${e.personaId} -> tool:${e.toolName}] ${JSON.stringify(e.params).slice(0, 400)}`
          );
          break;
        case 'tool_result': {
          const summary = e.evidenceSummary
            ? e.evidenceSummary.slice(0, 400)
            : JSON.stringify(e.result).slice(0, 400);
          lines.push(`[${e.personaId} <- tool:${e.toolName}] ${summary}`);
          break;
        }
        case 'handoff_out':
          lines.push(
            `[handoff ${e.packet.sourcePersonaId} -> ${e.packet.targetPersonaId}] ${e.packet.objective.slice(0, 200)}`
          );
          break;
        case 'handoff_in':
          lines.push(`[handoff accepted by ${e.acceptedBy}] packet:${e.packetId}`);
          break;
        case 'review_requested':
          lines.push(`[review requested ${e.personaId} risk:${e.riskLevel}]`);
          break;
        case 'review_decision':
          lines.push(
            `[review ${e.decision} by ${e.reviewerId}] ${e.feedback ?? ''}`.trim()
          );
          break;
        case 'system_note':
          lines.push(`[system:${e.noteKind}] ${e.text}`);
          break;
      }
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for thread events
// ---------------------------------------------------------------------------

export const BaseThreadEventSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  kind: z.enum([
    'user_message',
    'persona_message',
    'tool_call',
    'tool_result',
    'handoff_out',
    'handoff_in',
    'review_requested',
    'review_decision',
    'system_note',
  ]),
  createdAt: z.string().min(1),
  visibility: VisibilityLabelSchema,
  actorId: z.string().min(1),
  parentEventId: z.string().optional(),
});

export const ThreadSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  initiatingUserId: z.string().min(1),
  primaryPersonaId: z.string().min(1),
  teamId: z.string().optional(),
  employeeId: z.string().optional(),
  title: z.string().min(1).max(200),
  status: z.enum(['open', 'resolved', 'archived']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
