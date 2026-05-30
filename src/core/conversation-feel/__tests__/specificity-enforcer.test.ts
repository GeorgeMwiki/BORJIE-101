import { describe, it, expect } from "vitest";
import {
  checkSpecificity,
  extractSpecifics,
} from "../continuity/specificity-enforcer";
import type { ConversationContext } from "../types";

const ctx = (msg: string): ConversationContext => ({
  session_id: "s",
  turn_index: 1,
  portal: "borrower",
  user_message: msg,
  recent_turns: [],
});

describe("specificity-enforcer", () => {
  it("extracts proper nouns, amounts, and dates", () => {
    const s = extractSpecifics(
      "Mwananchi shop owes 2,500,000 TZS due 2026-05-31",
    );
    expect(s.proper_nouns).toContain("Mwananchi");
    expect(s.amounts.some((a) => a.includes("2,500,000"))).toBe(true);
    expect(s.dates.some((d) => d.includes("2026-05-31"))).toBe(true);
  });

  it("flags missing user proper noun in response", () => {
    const c = checkSpecificity(
      "I see the loan is 5,000,000 TZS for the shop.",
      ctx("Aisha applied for 5,000,000 TZS"),
    );
    expect(c.missing_user_words).toContain("Aisha");
    expect(c.regen_instruction).not.toBeNull();
  });

  it("flags rounding (5,123,000 -> 5,000,000)", () => {
    const c = checkSpecificity(
      "Your loan of 5,000,000 TZS is approved.",
      ctx("My loan request is 5,123,000 TZS"),
    );
    expect(c.rounded_numbers.length).toBeGreaterThan(0);
  });

  it("flags paraphrased dates ('soon' instead of '2026-06-15')", () => {
    const c = checkSpecificity(
      "Your repayment is due soon.",
      ctx("My repayment is on 2026-06-15"),
    );
    expect(c.paraphrased_dates.length).toBeGreaterThan(0);
  });

  it("passes when response uses the same exact words", () => {
    const c = checkSpecificity(
      "Aisha's loan of 5,123,000 TZS is approved.",
      ctx("Aisha applied for 5,123,000 TZS"),
    );
    expect(c.is_specific).toBe(true);
  });
});
