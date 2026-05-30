/**
 * Owner-to-owner messaging brain tools — chat-as-OS parity for migration 0107.
 *
 * Three tools backing `/api/v1/owner/threads`:
 *
 *   - `owner.messaging.send_to`     WRITE: send a message in a thread
 *   - `owner.messaging.unread_count` READ: inbox unread aggregate
 *   - `owner.messaging.thread_list`  READ: inbox listing
 *
 * Send is MEDIUM stakes (outbound communication on behalf of the
 * owner). It emits an audit entry and forwards chat provenance so the
 * recipient sees the "via Mr. Mwikila" pill on every message the LLM
 * sent on the owner's behalf.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

// ---------------------------------------------------------------------------
// 1. owner.messaging.send_to (WRITE)
// ---------------------------------------------------------------------------

const SendInput = z.object({
  threadId: z.string().uuid(),
  bodyMd: z.string().min(1).max(20_000),
  attachments: z.array(z.record(z.unknown())).max(20).default([]),
});
const SendOutput = z.object({
  id: z.string(),
  threadId: z.string(),
  sentAt: z.string(),
});
export const ownerMessagingSendToTool: PersonaToolDescriptor<
  typeof SendInput,
  typeof SendOutput
> = {
  id: 'owner.messaging.send_to',
  name: 'Owner messaging — send to thread',
  description:
    'Send a message in an existing owner thread. Defers to ' +
    '/owner/threads/:id/messages. Provenance forwards via=chat.',
  personaSlugs: OWNER,
  inputSchema: SendInput,
  outputSchema: SendOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        threadId: input.threadId,
        sentAt: new Date().toISOString(),
      };
    }
    const response = await client.post<{
      success: boolean;
      data: Record<string, unknown>;
    }>(
      `/owner/threads/${input.threadId}/messages`,
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          bodyMd: input.bodyMd,
          attachments: input.attachments,
        },
        ctx,
      ),
    );
    const row = response.data ?? {};
    return {
      id: String(row.id ?? ''),
      threadId: String(row.thread_id ?? input.threadId),
      sentAt: String(row.sent_at ?? new Date().toISOString()),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. owner.messaging.unread_count (READ)
// ---------------------------------------------------------------------------

const UnreadCountInput = z.object({});
const UnreadCountOutput = z.object({
  totalThreads: z.number().int(),
  openThreads: z.number().int(),
  unreadMessages: z.number().int(),
});
export const ownerMessagingUnreadCountTool: PersonaToolDescriptor<
  typeof UnreadCountInput,
  typeof UnreadCountOutput
> = {
  id: 'owner.messaging.unread_count',
  name: 'Owner messaging — unread count',
  description:
    "Aggregate the current owner's inbox: total threads, open " +
    'threads, and true unread-message count (messages the owner has ' +
    'not yet marked read and did not send themselves). Read-only — ' +
    'defers to GET /owner/threads/unread-count.',
  personaSlugs: OWNER,
  inputSchema: UnreadCountInput,
  outputSchema: UnreadCountOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { totalThreads: 0, openThreads: 0, unreadMessages: 0 };
    const response = await client.get<{
      success: boolean;
      data?: {
        totalThreads?: number;
        openThreads?: number;
        unreadMessages?: number;
      };
    }>('/owner/threads/unread-count');
    const row = response.data ?? {};
    return {
      totalThreads: Number(row.totalThreads ?? 0),
      openThreads: Number(row.openThreads ?? 0),
      unreadMessages: Number(row.unreadMessages ?? 0),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. owner.messaging.thread_list (READ)
// ---------------------------------------------------------------------------

const ThreadListInput = z.object({
  status: z.enum(['open', 'closed', 'archived']).optional(),
  limit: z.number().int().positive().max(100).default(20),
});
const ThreadListOutput = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      status: z.string(),
      lastActivityAt: z.string(),
    }),
  ),
});
export const ownerMessagingThreadListTool: PersonaToolDescriptor<
  typeof ThreadListInput,
  typeof ThreadListOutput
> = {
  id: 'owner.messaging.thread_list',
  name: 'Owner messaging — thread list',
  description:
    'List the current owner\'s threads with subject + status + last activity. ' +
    'Optional status filter. Read-only — defers to /owner/threads.',
  personaSlugs: OWNER,
  inputSchema: ThreadListInput,
  outputSchema: ThreadListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { threads: [] };
    // tenantId is bound from the JWT by the route — sending it as a
    // query param is a no-op and pollutes audit logs, so we omit it.
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/owner/threads', {
      query: {
        status: input.status,
        limit: input.limit,
      },
    });
    const rows = response.data ?? [];
    return {
      threads: rows.map((r) => ({
        id: String(r.id),
        subject: String(r.subject),
        status: String(r.status),
        lastActivityAt: String(r.last_activity_at),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Export catalogue.
// ---------------------------------------------------------------------------

export const OWNER_MESSAGING_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  ownerMessagingSendToTool,
  ownerMessagingUnreadCountTool,
  ownerMessagingThreadListTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
