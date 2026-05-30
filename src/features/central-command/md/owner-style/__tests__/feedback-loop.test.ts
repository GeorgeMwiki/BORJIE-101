import { describe, it, expect } from "vitest";
import {
  applyFeedback,
  applyFeedbackText,
  parseFeedbackText,
} from "../feedback-loop";
import { makeDefaultProfile } from "../style-dimensions";

const owner = {
  tenantId: "t",
  ownerUserId: "u",
  now: () => "2026-05-17T00:00:00.000Z",
};
const FIXED_NOW = () => "2026-05-17T12:00:00.000Z";

describe("feedback-loop", () => {
  it("too_long signal pushes verbosity towards terse", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      { kind: "too_long" },
      { now: FIXED_NOW },
    );
    expect(after.verbosity.value).toBe("terse");
    expect(after.verbosity.weights.terse).toBeGreaterThan(
      before.verbosity.weights.terse,
    );
    expect(after.sampleSize).toBe(1);
  });

  it("more_detail signal pushes verbosity towards verbose", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      { kind: "more_detail" },
      { now: FIXED_NOW },
    );
    expect(after.verbosity.value).toBe("verbose");
  });

  it("use_swahili signal flips language preference", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      { kind: "use_swahili" },
      { now: FIXED_NOW },
    );
    expect(after.languagePreference.value).toBe("swahili_leaning_bilingual");
  });

  it("just_do_it signal pushes decisionStyle directive", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      { kind: "just_do_it" },
      { now: FIXED_NOW },
    );
    expect(after.decisionStyle.value).toBe("directive");
  });

  it("more_cautious signal pushes risk conservative", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      { kind: "more_cautious" },
      { now: FIXED_NOW },
    );
    expect(after.riskAppetite.value).toBe("conservative");
  });

  it("does NOT mutate input profile", () => {
    const before = makeDefaultProfile(owner);
    const snap = JSON.stringify(before);
    applyFeedback(before, { kind: "too_long" }, { now: FIXED_NOW });
    expect(JSON.stringify(before)).toBe(snap);
  });

  it("parseFeedbackText recognises common phrases", () => {
    expect(parseFeedbackText("this is too long")?.kind).toBe("too_long");
    expect(parseFeedbackText("use swahili please")?.kind).toBe("use_swahili");
    expect(parseFeedbackText("give me options")?.kind).toBe("give_me_options");
    expect(parseFeedbackText("be more aggressive!")?.kind).toBe(
      "more_aggressive",
    );
    expect(parseFeedbackText("nothing here")).toBeNull();
  });

  it("applyFeedbackText returns the same profile when no signal parsed", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedbackText(before, "nothing relevant", {
      now: FIXED_NOW,
    });
    expect(after).toBe(before);
  });

  it("applyFeedbackText updates profile when phrase recognised", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedbackText(before, "be brief please", {
      now: FIXED_NOW,
    });
    expect(after.verbosity.value).toBe("terse");
  });

  it("invalid signal is rejected and prior returned", () => {
    const before = makeDefaultProfile(owner);
    const after = applyFeedback(
      before,
      // @ts-expect-error intentional bad signal
      { kind: "garbage" },
      { now: FIXED_NOW },
    );
    expect(after).toBe(before);
  });

  it("repeated negative feedback accumulates", () => {
    let p = makeDefaultProfile(owner);
    for (let i = 0; i < 4; i++) {
      p = applyFeedback(p, { kind: "too_long" }, { now: FIXED_NOW });
    }
    expect(p.verbosity.confidence).toBeGreaterThan(0.7);
  });
});
