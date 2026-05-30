import { describe, it, expect } from "vitest";
import { checkContinuity, recordFact } from "../continuity/continuity-enforcer";
import type { ConversationContext } from "../types";

const baseCtx = (
  overrides: Partial<ConversationContext>,
): ConversationContext => ({
  session_id: "s1",
  turn_index: 3,
  portal: "borrower",
  user_message: "What about my asset valuation?",
  recent_turns: [
    {
      role: "user",
      content: "I want a loan for my Mwananchi shop",
      turn_index: 0,
    },
    { role: "assistant", content: "Tell me your collateral.", turn_index: 1 },
    {
      role: "user",
      content: "I have a delivery truck worth 12,500,000 TZS",
      turn_index: 2,
    },
  ],
  ...overrides,
});

describe("continuity-enforcer", () => {
  it("passes when response quotes a 3-word run from a recent user turn", () => {
    const ctx = baseCtx({});
    const c = checkContinuity(
      "A delivery truck worth 12,500,000 TZS is solid collateral.",
      ctx,
    );
    expect(c.has_continuity).toBe(true);
    expect(c.anchor_kind).toBe("quote");
  });

  it("passes when response references a known user fact value", () => {
    const ctx: ConversationContext = baseCtx({
      known_user_facts: [
        { key: "shop_name", value: "Mwananchi", source_turn: 0 },
      ],
    });
    const c = checkContinuity(
      "For your Mwananchi shop, the loan ratio is 70%.",
      ctx,
    );
    expect(c.has_continuity).toBe(true);
    expect(c.anchor_kind).toBe("fact_callback");
  });

  it("requests regen when no continuity link exists", () => {
    const ctx = baseCtx({});
    const c = checkContinuity(
      "The interest rate changes monthly based on macro conditions.",
      ctx,
    );
    expect(c.has_continuity).toBe(false);
    expect(c.regen_instruction).not.toBeNull();
  });

  it("skips continuity requirement on turn 1", () => {
    const ctx = baseCtx({ turn_index: 1, recent_turns: [] });
    const c = checkContinuity("Hello — how can I help?", ctx);
    expect(c.has_continuity).toBe(true);
  });

  it("recordFact returns a new immutable state with the fact appended", () => {
    const state = {
      session_id: "s1",
      known_facts: [],
      open_threads: [],
    };
    const next = recordFact(state, {
      key: "loan_amount",
      value: "5,000,000",
      source_turn: 2,
    });
    expect(next).not.toBe(state);
    expect(next.known_facts).toHaveLength(1);
    expect(state.known_facts).toHaveLength(0);
  });
});
