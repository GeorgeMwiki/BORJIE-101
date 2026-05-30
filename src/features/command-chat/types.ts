/**
 * Command-chat client types.
 */

import type { ToolTier } from "./tool-policy";

export interface CommandChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly argsRedacted: Record<string, unknown>;
  readonly tier: ToolTier;
  readonly status:
    | "running"
    | "ok"
    | "error"
    | "awaiting-confirm"
    | "cancelled";
  readonly result?: unknown;
  readonly errorMessage?: string;
  readonly expiresAtMs?: number;
}

export interface CommandChatGenerativeUi {
  readonly toolCallId: string;
  readonly spec: { readonly type: string; readonly [k: string]: unknown };
}

export interface CommandChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly toolCalls: ReadonlyArray<CommandChatToolCall>;
  readonly generativeUi: ReadonlyArray<CommandChatGenerativeUi>;
  readonly traceId?: string;
  readonly createdAt: number;
}

export interface CommandChatSendOptions {
  readonly sessionId: string;
}
