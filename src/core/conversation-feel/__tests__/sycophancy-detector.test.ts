import { describe, it, expect } from "vitest";
import {
  checkSycophancy,
  expressesAgreement,
  extractAssertion,
  findContradiction,
} from "../guards/sycophancy-detector";
import type { ConversationContext } from "../types";

describe("sycophancy-detector", () => {
  it("extracts user fact-shaped assertions", () => {
    const a = extractAssertion("My monthly income is 800,000 TZS");
    expect(a).not.toBeNull();
    expect(a?.key.toLowerCase()).toContain("income");
  });

  it("detects agreement language in candidate", () => {
    expect(expressesAgreement("Yes, that's correct.")).toBe(true);
    expect(expressesAgreement("You're absolutely right.")).toBe(true);
    expect(expressesAgreement("Let me explain the rules.")).toBe(false);
  });

  it("finds contradiction when known fact differs from assertion", () => {
    const evidence = findContradiction(
      { key: "monthly income", asserted_value: "800,000", span: "" },
      [{ key: "monthly_income", value: "1,200,000", source_turn: 1 }],
    );
    expect(evidence).not.toBeNull();
    expect(evidence?.true_value).toBe("1,200,000");
  });

  it("flags sycophancy when assistant agrees with a contradicted assertion", () => {
    const ctx: ConversationContext = {
      session_id: "s",
      turn_index: 2,
      portal: "borrower",
      user_message: "My monthly income is 800,000 TZS",
      recent_turns: [],
      known_user_facts: [
        { key: "monthly_income", value: "1,200,000", source_turn: 1 },
      ],
    };
    const c = checkSycophancy("Yes, that's correct — got it.", ctx);
    expect(c.detected).toBe(true);
    expect(c.regen_instruction).not.toBeNull();
  });

  it("does not flag when no contradiction exists", () => {
    const ctx: ConversationContext = {
      session_id: "s",
      turn_index: 2,
      portal: "borrower",
      user_message: "My monthly income is 1,200,000 TZS",
      recent_turns: [],
      known_user_facts: [
        { key: "monthly_income", value: "1,200,000", source_turn: 1 },
      ],
    };
    const c = checkSycophancy("Yes, that's correct.", ctx);
    expect(c.detected).toBe(false);
  });
});
