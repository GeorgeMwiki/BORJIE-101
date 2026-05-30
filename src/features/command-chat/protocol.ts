/**
 * Command Chat SSE protocol.
 *
 * Shared between the route handler and the client useChat hook so
 * event names and payload shapes never drift. Each event is a plain
 * JSON-serialisable object; the route serialises with the canonical
 * `event: <name>\ndata: <json>\n\n` SSE shape.
 *
 * Events:
 *  - token            text delta from the model
 *  - tool-call        the model just emitted a tool_use block
 *  - tool-result      a tool finished executing
 *  - generative-ui    a tool result carries a UI block spec (rendered
 *                     via the AdaptiveRenderer registry)
 *  - confirm-needed   a write/destructive tool was requested but
 *                     parked, awaiting user Confirm via the
 *                     /confirm/[toolCallId] endpoint
 *  - decision-trace   the trace id assigned to this turn (used to
 *                     open the replay surface)
 *  - md.observation   the MD agent noticed something in business state
 *  - md.assessment    the MD agent scored a signal against a framework
 *  - md.proposal      the MD agent is recommending a next move
 *  - md.action        the MD agent is acting (with approval or autonomously)
 *  - md.follow-up     the MD agent scheduled a follow-up reminder
 *  - md.style-update  the owner-style profile shifted this turn
 *  - done             stream summary
 *  - error            non-fatal error
 */

export interface CommandChatTokenEvent {
  readonly content: string;
}

export interface CommandChatToolCallEvent {
  readonly toolCallId: string;
  readonly toolName: string;
  /** Args after PII redaction. Server-side validation already ran. */
  readonly argsRedacted: Record<string, unknown>;
  readonly tier: "read" | "write" | "destructive" | "sovereign";
}

export interface CommandChatToolResultEvent {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly errorMessage?: string;
}

export interface CommandChatGenerativeUiEvent {
  readonly toolCallId: string;
  /** Block spec that AdaptiveRenderer (or any host) can render. */
  readonly spec: {
    readonly type: string;
    readonly [key: string]: unknown;
  };
}

export interface CommandChatConfirmNeededEvent {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly tier: "write" | "destructive" | "sovereign";
  readonly argsPreview: Record<string, unknown>;
  /** Dry-run diff returned by the tool when supported. */
  readonly dryRunPreview?: unknown;
  /** Confirmation TTL in seconds. */
  readonly expiresInSec: number;
}

export interface CommandChatDecisionTraceEvent {
  readonly traceId: string;
}

export interface CommandChatDoneEvent {
  readonly turnsUsed: number;
  readonly toolCallsExecuted: number;
  readonly parked: number;
}

export interface CommandChatErrorEvent {
  readonly error: string;
  readonly correlationId?: string;
}

/**
 * A realtime-feed event surfaced into the open chat session. Sent
 * out-of-band relative to the tool-use loop: an officer in tenant A
 * approving a proposal, a drift signal firing, a cron tick failing,
 * etc. The chat UI typically renders these as inline notifications
 * (banner / toast), NOT as assistant turns.
 *
 * `severity` derives from the brain feed's salience floor:
 *  - "info"     — observational (intelligence events, normal cron)
 *  - "success"  — approval granted, cron completed clean
 *  - "warn"     — approval denied, drift signal at watch level
 *  - "crit"     — officer alert at crit level, failed cron
 */
export interface CommandChatRealtimeNotificationEvent {
  readonly kind:
    | "approval-granted"
    | "approval-denied"
    | "officer-alert"
    | "intelligence"
    | "cron-tick";
  readonly severity: "info" | "success" | "warn" | "crit";
  readonly summary: string;
  /** Optional: the subject id (application/approval id) for deep links. */
  readonly subjectId?: string;
  readonly ts: number;
}

// ---------------------------------------------------------------------------
// MD (Managing Director) overlay events.
//
// The MD orchestrator emits a typed event stream during a turn. Each kind
// maps 1:1 to an `MdEvent` discriminant from
// `@/features/central-command/md/core/types`. We restate the shapes here as
// a lightweight payload contract so command-chat can carry them without
// taking a hard dep on the md package (the chat surface validates payloads
// at the route boundary via Zod).
// ---------------------------------------------------------------------------

export interface CommandChatMdEnvelope<TKind extends string> {
  readonly kind: TKind;
  readonly eventId: string;
  readonly ts: number;
  /** The remaining shape is validated against `MdEventSchema` at the route. */
  readonly [k: string]: unknown;
}

export type CommandChatMdObservationEvent =
  CommandChatMdEnvelope<"md.observation">;
export type CommandChatMdAssessmentEvent =
  CommandChatMdEnvelope<"md.assessment">;
export type CommandChatMdProposalEvent = CommandChatMdEnvelope<"md.proposal">;
export type CommandChatMdActionEvent = CommandChatMdEnvelope<"md.action">;
export type CommandChatMdFollowUpEvent = CommandChatMdEnvelope<"md.follow-up">;
export type CommandChatMdStyleUpdateEvent =
  CommandChatMdEnvelope<"md.style-update">;

export const COMMAND_CHAT_MD_EVENT_NAMES = [
  "md.observation",
  "md.assessment",
  "md.proposal",
  "md.action",
  "md.follow-up",
  "md.style-update",
] as const;

export type CommandChatMdEventName =
  (typeof COMMAND_CHAT_MD_EVENT_NAMES)[number];

export type CommandChatEvent =
  | { readonly event: "token"; readonly data: CommandChatTokenEvent }
  | { readonly event: "tool-call"; readonly data: CommandChatToolCallEvent }
  | { readonly event: "tool-result"; readonly data: CommandChatToolResultEvent }
  | {
      readonly event: "generative-ui";
      readonly data: CommandChatGenerativeUiEvent;
    }
  | {
      readonly event: "confirm-needed";
      readonly data: CommandChatConfirmNeededEvent;
    }
  | {
      readonly event: "decision-trace";
      readonly data: CommandChatDecisionTraceEvent;
    }
  | {
      readonly event: "realtime-notification";
      readonly data: CommandChatRealtimeNotificationEvent;
    }
  | {
      readonly event: "md.observation";
      readonly data: CommandChatMdObservationEvent;
    }
  | {
      readonly event: "md.assessment";
      readonly data: CommandChatMdAssessmentEvent;
    }
  | {
      readonly event: "md.proposal";
      readonly data: CommandChatMdProposalEvent;
    }
  | {
      readonly event: "md.action";
      readonly data: CommandChatMdActionEvent;
    }
  | {
      readonly event: "md.follow-up";
      readonly data: CommandChatMdFollowUpEvent;
    }
  | {
      readonly event: "md.style-update";
      readonly data: CommandChatMdStyleUpdateEvent;
    }
  | { readonly event: "done"; readonly data: CommandChatDoneEvent }
  | { readonly event: "error"; readonly data: CommandChatErrorEvent };

export function isCommandChatMdEventName(
  name: string,
): name is CommandChatMdEventName {
  return (COMMAND_CHAT_MD_EVENT_NAMES as ReadonlyArray<string>).includes(name);
}

export function encodeSseEvent(evt: CommandChatEvent): string {
  return `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}

/** Parse a single `event: x\ndata: y\n\n` block. Returns null when
 *  the chunk is incomplete. Caller buffers the remainder. */
export function parseSseEvent(chunk: string): CommandChatEvent | null {
  const lines = chunk.split("\n");
  let evt = "";
  let dataLine = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      evt = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }
  if (!evt || !dataLine) return null;
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    // The protocol is owned end-to-end; the server only emits the
    // shapes above and the client treats the cast as a narrowing
    // step. Use `unknown` first to satisfy the strict discriminated-
    // union check, then narrow.
    return { event: evt, data } as unknown as CommandChatEvent;
  } catch {
    return null;
  }
}
