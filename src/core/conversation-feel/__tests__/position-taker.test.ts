import { describe, it, expect } from "vitest";
import {
  checkPosition,
  countHedges,
  takesPosition,
  userAskedForOpinion,
} from "../guards/position-taker";
import type { ConversationContext } from "../types";

const ctx = (msg: string): ConversationContext => ({
  session_id: "s",
  turn_index: 1,
  portal: "borrower",
  user_message: msg,
  recent_turns: [],
});

describe("position-taker", () => {
  it("detects opinion-asking phrases", () => {
    expect(userAskedForOpinion("Should I take the 12-month loan?")).toBe(true);
    expect(userAskedForOpinion("What do you think about VICOBA?")).toBe(true);
    expect(
      userAskedForOpinion("In your opinion, is collateral required?"),
    ).toBe(true);
    expect(userAskedForOpinion("My loan is 5,000,000")).toBe(false);
  });

  it("counts hedge phrases", () => {
    const n = countHedges(
      "It might be 10% or maybe 12%, perhaps even 15% in some cases.",
    );
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("recognises position markers", () => {
    expect(takesPosition("I recommend the 12-month term.")).toBe(true);
    expect(takesPosition("My recommendation is to wait.")).toBe(true);
    expect(takesPosition("It could be A, B, or C.")).toBe(false);
  });

  it("requests regen when opinion was asked but no position is taken", () => {
    const c = checkPosition(
      "It could be a 12-month or 24-month loan, depending on your needs.",
      ctx("Should I pick a 12-month loan?"),
    );
    expect(c.user_asked_for_opinion).toBe(true);
    expect(c.regen_instruction).not.toBeNull();
  });

  it("requests regen when hedge overload (>1) and uncertainty not genuine", () => {
    const c = checkPosition(
      "It might be A, perhaps B, possibly C.",
      ctx("Tell me about loan terms"),
    );
    expect(c.hedge_overload).toBe(true);
    expect(c.regen_instruction).not.toBeNull();
  });

  it("allows up to 3 hedges when calibrated uncertainty is genuine", () => {
    const c = checkPosition("It might be A, perhaps B, possibly C.", {
      ...ctx("loan terms"),
      is_genuinely_uncertain: true,
    });
    expect(c.hedge_overload).toBe(false);
  });
});
