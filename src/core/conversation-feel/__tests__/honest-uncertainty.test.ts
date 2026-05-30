import { describe, it, expect } from "vitest";
import {
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
} from "../guards/honest-uncertainty";

describe("honest-uncertainty", () => {
  it("admits when confidence below tier threshold", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 20,
      missing_required_info: [],
      retrieval_returned_empty: false,
      tier: "medium",
      question_topic: "the BOT directive number",
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe("low_confidence");
    expect(r.user_facing).toMatch(/I'm not confident/i);
  });

  it("admits when required fields are missing", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: ["collateral_value"],
      retrieval_returned_empty: false,
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe("missing_info");
    expect(r.user_facing).toMatch(/collateral_value/);
  });

  it("admits when retrieval was empty", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 80,
      missing_required_info: [],
      retrieval_returned_empty: true,
      question_topic: "the case file",
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe("no_retrieval_match");
  });

  it("does not admit when confidence is high and info present", () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: [],
      retrieval_returned_empty: false,
    });
    expect(r.should_admit).toBe(false);
  });

  it("strips theatre apology around 'I cannot'", () => {
    const c = stripTheatreFromUncertainty(
      "I'm so sorry, but I cannot share that information.",
    );
    expect(c.toLowerCase()).not.toMatch(/i'?m so sorry/);
    expect(c.toLowerCase()).toMatch(/cannot/);
  });

  it("strips 'unfortunately, I' theatre", () => {
    const c = stripTheatreFromUncertainty(
      "Unfortunately, I don't have access to that table.",
    );
    expect(c.toLowerCase()).not.toMatch(/^unfortunately/);
  });
});
