/**
 * Iter-25 port-audit fix: CommandChat React shell (Carboni Open Item #2).
 *
 * Locks the contract that the protocol round-trips losslessly and that
 * `parseSseEvent` handles every documented event kind. The React
 * component itself is exercised in isolation by future component tests
 * (when the host page that uses it lands); for now we focus on the
 * pure protocol surface so the contract is auditable today.
 */

import { describe, it, expect } from "vitest";
import {
  encodeSseEvent,
  parseSseEvent,
  isCommandChatMdEventName,
  COMMAND_CHAT_MD_EVENT_NAMES,
  type CommandChatEvent,
} from "../protocol";

describe("command-chat protocol — round-trip", () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly event: CommandChatEvent;
  }> = [
    {
      label: "token",
      event: { event: "token", data: { content: "hello" } },
    },
    {
      label: "tool-call",
      event: {
        event: "tool-call",
        data: {
          toolCallId: "tc-1",
          toolName: "get_loan_status",
          argsRedacted: { loanId: "loan-1" },
          tier: "read",
        },
      },
    },
    {
      label: "tool-result ok",
      event: {
        event: "tool-result",
        data: {
          toolCallId: "tc-1",
          toolName: "get_loan_status",
          ok: true,
          result: { status: "approved" },
        },
      },
    },
    {
      label: "tool-result error",
      event: {
        event: "tool-result",
        data: {
          toolCallId: "tc-1",
          toolName: "get_loan_status",
          ok: false,
          errorMessage: "loan not found",
        },
      },
    },
    {
      label: "generative-ui",
      event: {
        event: "generative-ui",
        data: {
          toolCallId: "tc-2",
          spec: { type: "table", rows: [{ a: 1 }] },
        },
      },
    },
    {
      label: "confirm-needed",
      event: {
        event: "confirm-needed",
        data: {
          toolCallId: "tc-3",
          toolName: "disburse_loan",
          tier: "destructive",
          argsPreview: { amountTzs: 500000 },
          expiresInSec: 300,
        },
      },
    },
    {
      label: "decision-trace",
      event: {
        event: "decision-trace",
        data: { traceId: "trace-9" },
      },
    },
    {
      label: "done",
      event: {
        event: "done",
        data: { turnsUsed: 1, toolCallsExecuted: 2, parked: 0 },
      },
    },
    {
      label: "error",
      event: {
        event: "error",
        data: { error: "model timeout" },
      },
    },
  ];

  for (const { label, event } of cases) {
    it(`round-trips a ${label} event`, () => {
      const sse = encodeSseEvent(event);
      const parsed = parseSseEvent(sse.replace(/\n\n$/, ""));
      expect(parsed).toEqual(event);
    });
  }
});

describe("command-chat protocol — MD discriminator", () => {
  it("recognises every documented MD event name", () => {
    for (const name of COMMAND_CHAT_MD_EVENT_NAMES) {
      expect(isCommandChatMdEventName(name)).toBe(true);
    }
  });

  it("rejects non-MD names", () => {
    expect(isCommandChatMdEventName("token")).toBe(false);
    expect(isCommandChatMdEventName("error")).toBe(false);
    expect(isCommandChatMdEventName("md.unknown")).toBe(false);
  });
});

describe("command-chat protocol — SSE parsing edge cases", () => {
  it("returns null for an incomplete chunk", () => {
    expect(parseSseEvent("event: token")).toBeNull();
    expect(parseSseEvent('data: { "content": "hi" }')).toBeNull();
  });

  it("returns null for a chunk with malformed JSON", () => {
    expect(parseSseEvent("event: token\ndata: { not-json }")).toBeNull();
  });
});
