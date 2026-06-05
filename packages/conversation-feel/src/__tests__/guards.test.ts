/**
 * conversation-feel guard tests (LP-24a).
 *
 * Each pure guard gets unit coverage: anti-pattern stripper, sycophancy
 * detector, brevity guard, position-taker, honest-uncertainty, rhythm.
 */

import { describe, expect, it } from "vitest";
import {
  stripChatbotFeel,
  shouldRequestRegen,
  checkSycophancy,
  extractAssertion,
  expressesAgreement,
  checkBrevity,
  countWords,
  countBullets,
  inferTurnKind,
  checkPosition,
  userAskedForOpinion,
  countHedges,
  takesPosition,
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
  analyzeRhythm,
  rhythmInjection,
} from "../guards/index";
import type { ConversationContext, RecentTurn } from "../types";

function ctx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    session_id: "s1",
    turn_index: 1,
    portal: "owner",
    user_message: "",
    recent_turns: [],
    ...overrides,
  };
}

describe("anti-pattern-stripper", () => {
  it("strips a filler opener and preserves the substance", () => {
    const r = stripChatbotFeel("Sure! The royalty rate is 7 percent.");
    expect(r.stripped).toBe("The royalty rate is 7 percent.");
    expect(r.removed_phrases.some((p) => p.pattern === "filler_opener")).toBe(true);
  });

  it("strips an anything-else closer", () => {
    const r = stripChatbotFeel(
      "Your licence renews on the 12th. Is there anything else I can help you with?",
    );
    expect(r.stripped).toBe("Your licence renews on the 12th.");
    expect(
      r.removed_phrases.some((p) => p.pattern === "anything_else_closer"),
    ).toBe(true);
  });

  it("peels chained openers across passes", () => {
    const r = stripChatbotFeel("Sure! Of course! The answer is 42.");
    expect(r.stripped).toBe("The answer is 42.");
  });

  it("leaves clean substance untouched", () => {
    const clean = "Drill core grades came back at 4.2 g/t.";
    const r = stripChatbotFeel(clean);
    expect(r.stripped).toBe(clean);
    expect(r.removed_phrases).toHaveLength(0);
  });

  it("flags regen when the response is mostly filler", () => {
    const r = stripChatbotFeel("Sure! I'd be happy to help. Hope this helps!");
    expect(shouldRequestRegen(r)).toBe(true);
  });
});

describe("sycophancy-detector", () => {
  it("extracts a fact-shaped assertion", () => {
    const a = extractAssertion("my royalty is 5 percent this year");
    expect(a?.key).toContain("royalty");
    expect(a?.asserted_value).toContain("5");
  });

  it("detects agreement", () => {
    expect(expressesAgreement("Yes, that's correct.")).toBe(true);
    expect(expressesAgreement("Let me check the figures.")).toBe(false);
  });

  it("pushes back when agreement contradicts a known fact", () => {
    const check = checkSycophancy(
      "Yes, you're right, 5 percent it is.",
      ctx({
        user_message: "my royalty is 5 percent",
        known_user_facts: [
          { key: "royalty", value: "7 percent", source_turn: 0 },
        ],
      }),
    );
    expect(check.detected).toBe(true);
    expect(check.regen_instruction).toContain("7 percent");
  });

  it("does not fire when there is no contradiction", () => {
    const check = checkSycophancy(
      "Yes, that's correct.",
      ctx({
        user_message: "my royalty is 7 percent",
        known_user_facts: [
          { key: "royalty", value: "7 percent", source_turn: 0 },
        ],
      }),
    );
    expect(check.detected).toBe(false);
    expect(check.regen_instruction).toBeNull();
  });
});

describe("brevity-guard", () => {
  it("counts words and bullets", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countBullets("- a\n- b\n- c")).toBe(3);
  });

  it("flags an over-limit smalltalk turn", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const r = checkBrevity(long, "smalltalk");
    expect(r.within_limit).toBe(false);
    expect(r.regen_instruction).toContain("Tighten");
  });

  it("allows a long justified teaching turn", () => {
    const teach =
      "Because the ore body dips steeply, consider the trade-off: " +
      "first, shallow benches reduce stripping; on the other hand, " +
      "deeper cuts expose higher grades. Imagine a 12-month horizon.";
    const r = checkBrevity(teach, "deep_teaching");
    expect(r.justified).toBe(true);
    expect(r.regen_instruction).toBeNull();
  });

  it("flags a 2-bullet mechanical list", () => {
    const r = checkBrevity("- alpha\n- beta", "explanation");
    expect(r.bullet_violation).toBe(true);
  });

  it("infers turn kinds", () => {
    expect(inferTurnKind("Habari", "")).toBe("smalltalk");
    expect(inferTurnKind("What is the royalty rate?", "")).toBe("question");
    expect(inferTurnKind("Should I sell the gold now?", "")).toBe("decision");
    expect(inferTurnKind("Explain how leaching works", "")).toBe("deep_teaching");
  });
});

describe("position-taker", () => {
  it("detects an opinion request", () => {
    expect(userAskedForOpinion("What do you recommend?")).toBe(true);
    expect(userAskedForOpinion("List the licences.")).toBe(false);
  });

  it("counts hedges and detects position", () => {
    expect(countHedges("Maybe, perhaps, it depends.")).toBeGreaterThanOrEqual(3);
    expect(takesPosition("I recommend selling the concentrate.")).toBe(true);
  });

  it("asks for a position when opinion requested but none taken", () => {
    const r = checkPosition(
      "There are several options, each with pros and cons.",
      ctx({ user_message: "What would you do?" }),
    );
    expect(r.user_asked_for_opinion).toBe(true);
    expect(r.response_takes_position).toBe(false);
    expect(r.regen_instruction).toContain("clear position");
  });

  it("flags hedge overload past the default limit", () => {
    const r = checkPosition(
      "It could be this, or maybe that, possibly, it depends.",
      ctx({ user_message: "Tell me about grades." }),
    );
    expect(r.hedge_overload).toBe(true);
    expect(r.regen_instruction).toContain("Reduce hedge");
  });

  it("relaxes the hedge limit when genuinely uncertain", () => {
    const r = checkPosition(
      "It could be this, or maybe that.",
      ctx({ user_message: "Grades?", is_genuinely_uncertain: true }),
    );
    expect(r.hedge_overload).toBe(false);
  });
});

describe("honest-uncertainty", () => {
  it("admits when required info is missing", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: ["assay results"],
      retrieval_returned_empty: false,
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe("missing_info");
    expect(r.user_facing).toContain("assay results");
    expect(r.avoids_theatre).toBe(true);
  });

  it("admits on low confidence per tier threshold", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 50,
      missing_required_info: [],
      retrieval_returned_empty: false,
      tier: "critical",
      question_topic: "the export levy",
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe("low_confidence");
  });

  it("stays silent when confident and complete", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 95,
      missing_required_info: [],
      retrieval_returned_empty: false,
    });
    expect(r.should_admit).toBe(false);
    expect(r.user_facing).toBe("");
  });

  it("strips a theatrical apology from an uncertainty line", () => {
    const out = stripTheatreFromUncertainty(
      "I'm so sorry, but I don't have that figure.",
    );
    expect(out.toLowerCase()).not.toContain("sorry");
    expect(out).toContain("don't have");
  });
});

describe("rhythm-analyzer", () => {
  function turn(content: string): RecentTurn {
    return { role: "assistant", content, turn_index: 0 };
  }

  it("returns zeroed score for no assistant turns", () => {
    const r = analyzeRhythm([{ role: "user", content: "hi", turn_index: 0 }]);
    expect(r.turns_analyzed).toBe(0);
    expect(r.flatlined).toBe(false);
  });

  it("detects a flatlined rhythm (uniform, no questions, no pauses)", () => {
    const r = analyzeRhythm([
      turn("The grade is good today here."),
      turn("The grade is fine today here."),
      turn("The grade is okay today here."),
    ]);
    expect(r.flatlined).toBe(true);
    expect(rhythmInjection(r)).toContain("flatlined");
  });

  it("does not flatline when a turn asks back", () => {
    const r = analyzeRhythm([
      turn("The grade is good."),
      turn("Numbers look fine."),
      turn("Want me to pull the assay history?"),
    ]);
    expect(r.flatlined).toBe(false);
    expect(rhythmInjection(r)).toBeNull();
  });
});
