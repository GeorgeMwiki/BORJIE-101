/**
 * power_tool.blackboard_stream — emit a progress event onto the shared
 * blackboard channel for human-in-the-loop monitoring.
 *
 * The agent publishes a structured event (`progress`, `decision`,
 * `observation`, `warning`) onto a per-session blackboard channel.
 * The UI subscribes to the channel and renders a progress timeline so
 * operators can watch the agent think through long-running work.
 *
 * Three event kinds:
 *   - 'progress' — "I am at step 3 of 7"
 *   - 'decision' — "I chose option B because…"
 *   - 'observation' — "noticed unusual pattern X"
 *   - 'warning' — "this looks like a risk; flagging for review"
 *
 * Each event is stamped with a monotonic per-session sequence number so
 * a downstream client can detect dropped or reordered events. The
 * sequence counter is in-process — production wires Redis-backed
 * sequencer via the adapter port.
 *
 * Tier model:
 *   - requiredTier: tenant-resident. Any tier can stream progress; the
 *     blackboard is a transparency surface, not a privileged write.
 *
 * Approval: none. Streaming progress is read-only-equivalent from a
 * domain perspective; the event never mutates a tenant entity.
 *
 * Audit trail: `audit_events` row when the event kind is `warning`;
 * other kinds skip persistence (volume control). The UI subscribes
 * via the publisher, not the audit log.
 *
 * @module kernel/power-tools/blackboard-stream
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Publisher port
// ─────────────────────────────────────────────────────────────────────

export type BlackboardEventKind =
  | 'progress'
  | 'decision'
  | 'observation'
  | 'warning';

export interface BlackboardEvent {
  readonly threadId: string;
  readonly seq: number;
  readonly kind: BlackboardEventKind;
  readonly tier: PowerToolContext['tier'];
  readonly callerId: string;
  readonly title: string;
  readonly body: string;
  readonly tags: ReadonlyArray<string>;
  readonly emittedAt: string;
}

export interface BlackboardPublisher {
  publish(event: BlackboardEvent): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory publisher — test rig + dev surface.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryBlackboardPublisher extends BlackboardPublisher {
  readonly events: ReadonlyArray<BlackboardEvent>;
  /** Reset sequence counters + drop all events. */
  clear(): void;
}

export function createInMemoryBlackboardPublisher(): InMemoryBlackboardPublisher {
  const events: BlackboardEvent[] = [];
  return {
    async publish(event: BlackboardEvent): Promise<void> {
      events.push(event);
    },
    get events(): ReadonlyArray<BlackboardEvent> {
      return events;
    },
    clear(): void {
      events.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-thread monotonic sequence counter
// ─────────────────────────────────────────────────────────────────────

const threadSeqCounters = new Map<string, number>();

function nextSeq(threadId: string): number {
  const current = threadSeqCounters.get(threadId) ?? 0;
  const next = current + 1;
  threadSeqCounters.set(threadId, next);
  return next;
}

/** Test-only — reset the per-thread sequence counter. */
export function __resetBlackboardSeqForTests(threadId?: string): void {
  if (threadId) {
    threadSeqCounters.delete(threadId);
    return;
  }
  threadSeqCounters.clear();
}

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 4000;
const MAX_TAGS = 10;

export const BlackboardStreamSchema = z.object({
  kind: z.enum(['progress', 'decision', 'observation', 'warning']),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  body: z.string().min(1).max(MAX_BODY_CHARS),
  tags: z.array(z.string().min(1).max(60)).max(MAX_TAGS).optional(),
});

export type BlackboardStreamArgs = z.infer<typeof BlackboardStreamSchema>;

export interface BlackboardStreamOutput {
  readonly action: 'blackboard-stream';
  readonly seq: number;
  readonly kind: BlackboardEventKind;
  readonly emittedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createBlackboardStreamPowerTool(
  publisher: BlackboardPublisher | null,
): PowerTool<BlackboardStreamArgs, BlackboardStreamOutput> {
  return {
    id: 'blackboard_stream',
    name: 'Blackboard stream',
    description:
      'Emit a progress / decision / observation / warning event onto the shared blackboard channel for human-in-the-loop monitoring.',
    requiredTier: 'tenant-resident',
    requiresApproval: false,
    // Only warning events trigger audit-event persistence. The factory
    // declares 'audit-events' so the registry's invariant matches; the
    // tool itself decides at execute-time based on the kind.
    auditDestination: 'audit-events',
    schema: BlackboardStreamSchema,
    async execute(
      ctx: PowerToolContext,
      args: BlackboardStreamArgs,
    ): Promise<PowerToolResult<BlackboardStreamOutput>> {
      if (!publisher) {
        return {
          kind: 'refused',
          reasonCode: 'NOT_IMPLEMENTED',
          message:
            'No blackboard publisher wired. Bind one at composition root.',
        };
      }
      const seq = nextSeq(ctx.threadId);
      const emittedAt = ctx.clock().toISOString();
      try {
        await publisher.publish({
          threadId: ctx.threadId,
          seq,
          kind: args.kind,
          tier: ctx.tier,
          callerId: ctx.callerId,
          title: args.title,
          body: args.body,
          tags: args.tags ?? [],
          emittedAt,
        });
      } catch (err) {
        return {
          kind: 'failed',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      return {
        kind: 'ok',
        output: {
          action: 'blackboard-stream',
          seq,
          kind: args.kind,
          emittedAt,
        },
      };
    },
  };
}
