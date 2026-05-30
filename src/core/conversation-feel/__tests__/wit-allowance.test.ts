import { describe, it, expect } from "vitest";
import { decideWit, witInjection } from "../style-audit/wit-allowance";
import type { ConversationContext } from "../types";

const ctx = (
  msg: string,
  portal: ConversationContext["portal"] = "borrower",
): ConversationContext => ({
  session_id: "s",
  turn_index: 1,
  portal,
  user_message: msg,
  recent_turns: [],
});

describe("wit-allowance", () => {
  it("allows wit when user is playful and quota unused", () => {
    const d = decideWit(
      { ...ctx("haha curious about loans"), turn_kind: "smalltalk" },
      0,
    );
    expect(d.allowed).toBe(true);
    expect(witInjection(d)).not.toBeNull();
  });

  it("denies wit when distress signals present", () => {
    const d = decideWit(ctx("I'm panicking about losing my home"), 0);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("user_distress_detected");
  });

  it("denies wit when register is formal", () => {
    const d = decideWit(
      ctx("I want to file a formal complaint with the regulator"),
      0,
    );
    expect(d.allowed).toBe(false);
  });

  it("denies wit when portal is marketing", () => {
    const d = decideWit(ctx("hi", "marketing"), 0);
    expect(d.allowed).toBe(false);
  });

  it("denies wit when quota already used this session", () => {
    const d = decideWit(
      { ...ctx("haha tell me more"), turn_kind: "smalltalk" },
      1,
    );
    expect(d.allowed).toBe(false);
    expect(d.already_used_this_session).toBe(true);
  });
});
