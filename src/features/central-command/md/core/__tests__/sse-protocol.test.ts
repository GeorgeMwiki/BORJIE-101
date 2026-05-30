/**
 * MD core - SSE protocol extension tests.
 *
 * Confirms that the command-chat protocol now carries the six MD event
 * names and that each round-trips through the encoder.
 */

import { describe, it, expect } from "vitest";

import {
  COMMAND_CHAT_MD_EVENT_NAMES,
  encodeSseEvent,
  isCommandChatMdEventName,
  parseSseEvent,
} from "@/features/command-chat/protocol";

describe("command-chat protocol MD overlay", () => {
  it("declares all 6 MD event names", () => {
    expect(COMMAND_CHAT_MD_EVENT_NAMES).toEqual([
      "md.observation",
      "md.assessment",
      "md.proposal",
      "md.action",
      "md.follow-up",
      "md.style-update",
    ]);
  });

  it("guards md event names", () => {
    for (const n of COMMAND_CHAT_MD_EVENT_NAMES) {
      expect(isCommandChatMdEventName(n)).toBe(true);
    }
    expect(isCommandChatMdEventName("token")).toBe(false);
  });

  it("round-trips an md.observation through SSE encode/parse", () => {
    const evt = {
      event: "md.observation" as const,
      data: {
        kind: "md.observation" as const,
        eventId: "x",
        ts: 1,
        severity: "info",
        summary: "ok",
        citations: [],
      },
    };
    const wire = encodeSseEvent(evt);
    expect(wire.startsWith("event: md.observation\n")).toBe(true);
    const back = parseSseEvent(wire);
    expect(back?.event).toBe("md.observation");
  });
});
