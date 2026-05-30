/**
 * Tests — anti-pattern stripper.
 */
import { describe, it, expect } from "vitest";
import {
  shouldRequestRegen,
  stripChatbotFeel,
} from "../guards/anti-pattern-stripper";

describe("anti-pattern-stripper", () => {
  it("strips filler openers like 'Sure!' and 'Of course!'", () => {
    const r = stripChatbotFeel(
      "Sure! Your loan options are 12-month and 24-month terms.",
    );
    expect(r.removed_phrases.length).toBeGreaterThanOrEqual(1);
    expect(r.stripped.toLowerCase()).not.toMatch(/^sure[!,.\s]/);
    expect(r.stripped).toMatch(/loan options/i);
  });

  it("strips 'Great question!' praise without losing substance", () => {
    const r = stripChatbotFeel(
      "Great question! The interest rate depends on your collateral.",
    );
    expect(r.removed_phrases.some((p) => p.pattern === "filler_opener")).toBe(
      true,
    );
    expect(r.stripped).toMatch(/interest rate depends/i);
  });

  it("strips 'is there anything else I can help you with?' closers", () => {
    const r = stripChatbotFeel(
      "Your balance is 5,000 TZS. Is there anything else I can help you with?",
    );
    expect(
      r.removed_phrases.some((p) => p.pattern === "anything_else_closer"),
    ).toBe(true);
    expect(r.stripped).toMatch(/balance is 5,000/);
  });

  it("strips theatrical apology around limitations", () => {
    const r = stripChatbotFeel(
      "I apologize for any confusion. The collateral value is required.",
    );
    expect(
      r.removed_phrases.some((p) => p.pattern === "theatrical_apology"),
    ).toBe(true);
    expect(r.stripped).toMatch(/collateral value is required/i);
  });

  it("strips sycophantic agreement", () => {
    const r = stripChatbotFeel(
      "That's a great point! However, the BOT directive is clear.",
    );
    expect(
      r.removed_phrases.some((p) => p.pattern === "sycophantic_agreement"),
    ).toBe(true);
    expect(r.stripped).toMatch(/BOT directive is clear/i);
  });

  it("preserves substance untouched when no patterns present", () => {
    const original =
      "Your collateral is below the required 120% loan-to-value ratio.";
    const r = stripChatbotFeel(original);
    expect(r.removed_phrases).toHaveLength(0);
    expect(r.stripped).toBe(original);
  });

  it("flags regen when most of the text was filler", () => {
    const r = stripChatbotFeel(
      "Great question! Of course! I'd be happy to. Hope this helps!",
    );
    expect(shouldRequestRegen(r)).toBe(true);
  });
});
