import { describe, it, expect } from "vitest";
import {
  checkBrevity,
  countBullets,
  countWords,
  inferTurnKind,
  isJustifiedLength,
} from "../guards/brevity-guard";

describe("brevity-guard", () => {
  it("counts words and bullets", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countBullets("- a\n- b\n* c")).toBe(3);
  });

  it("flags over-limit on a question turn", () => {
    const long = Array.from({ length: 100 }).fill("word").join(" ");
    const c = checkBrevity(long, "question");
    expect(c.within_limit).toBe(false);
    expect(c.regen_instruction).not.toBeNull();
  });

  it("allows long content when justified by teaching markers", () => {
    const teach =
      "First, the key reason is that interest compounds. Second, the trade-off " +
      "is between liquidity and yield. Imagine you take a 12-month term — what if " +
      "rates rise? The catch is that your fixed rate then looks worse. " +
      "Step 1: lock in. Step 2: hedge. Step 3: review monthly. " +
      Array.from({ length: 200 }).fill("word").join(" ");
    const c = checkBrevity(teach, "deep_teaching");
    expect(isJustifiedLength(teach)).toBe(true);
    expect(c.regen_instruction).toBeNull();
  });

  it("flags 1-2 bullet lists as mechanical", () => {
    const c = checkBrevity("Here:\n- one\n- two", "explanation");
    expect(c.bullet_violation).toBe(true);
  });

  it("allows 3+ bullets", () => {
    const c = checkBrevity("Here:\n- one\n- two\n- three", "explanation");
    expect(c.bullet_violation).toBe(false);
  });

  it("infers turn kind from user message", () => {
    expect(inferTurnKind("Hi there", "Hello")).toBe("smalltalk");
    expect(inferTurnKind("What is the rate?", "Short answer.")).toBe(
      "question",
    );
    expect(inferTurnKind("Should I refinance?", "Brief reply.")).toBe(
      "decision",
    );
    expect(inferTurnKind("Explain compound interest", "...")).toBe(
      "deep_teaching",
    );
  });
});
