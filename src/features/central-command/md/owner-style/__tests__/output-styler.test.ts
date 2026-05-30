import { describe, it, expect } from "vitest";
import { styleOutput } from "../output-styler";
import {
  makeDefaultProfile,
  type OwnerStyleProfile,
} from "../style-dimensions";

const owner = {
  tenantId: "t",
  ownerUserId: "u",
  now: () => "2026-05-17T00:00:00.000Z",
};
function withDim(overrides: Partial<OwnerStyleProfile>): OwnerStyleProfile {
  return { ...makeDefaultProfile(owner), ...overrides };
}

const LONG_TEXT =
  "Cashflow is tight this month. We expect a 15% recovery in week three. We should pause one hire. We can review next Friday.";

describe("output-styler", () => {
  it("terse owner: compresses long output", () => {
    const profile = withDim({
      verbosity: {
        value: "terse",
        weights: { terse: 9, balanced: 1, verbose: 1 },
        confidence: 0.81,
      },
    });
    const out = styleOutput(LONG_TEXT, profile);
    expect(out.text.split(/[.!?]/).filter(Boolean).length).toBeLessThanOrEqual(
      3,
    );
    expect(out.transformations).toContain("compress_to_terse");
  });

  it("verbose owner: expands short output with reasoning", () => {
    const profile = withDim({
      verbosity: {
        value: "verbose",
        weights: { terse: 1, balanced: 1, verbose: 9 },
        confidence: 0.81,
      },
    });
    const out = styleOutput("Pause the hire.", profile);
    expect(out.text.length).toBeGreaterThan("Pause the hire.".length);
    expect(out.transformations).toContain("expand_to_verbose");
  });

  it("directive owner: bullets multi-sentence output", () => {
    const profile = withDim({
      decisionStyle: {
        value: "directive",
        weights: { directive: 9, collaborative: 1, consultative: 1 },
        confidence: 0.81,
      },
    });
    const out = styleOutput(LONG_TEXT, profile);
    expect(
      out.text.split("\n").filter((l) => l.startsWith("- ")).length,
    ).toBeGreaterThanOrEqual(3);
    expect(out.transformations).toContain("bulletify");
  });

  it("email channel: wraps response in email scaffold", () => {
    const profile = withDim({
      channelPreference: {
        value: "chat_plus_email",
        weights: {
          chat_only: 1,
          chat_plus_email: 9,
          chat_plus_voice: 1,
          multi_channel: 1,
        },
        confidence: 0.75,
      },
    });
    const out = styleOutput("Pause the hire.", profile);
    expect(out.text).toMatch(/^Hi,/);
    expect(out.text).toMatch(/Best,\nMD$/);
  });

  it("swahili-leaning: prepends Habari opener", () => {
    const profile = withDim({
      languagePreference: {
        value: "swahili_leaning_bilingual",
        weights: {
          english_only: 1,
          swahili_leaning_bilingual: 9,
          english_leaning_bilingual: 1,
          swahili_only: 1,
        },
        confidence: 0.75,
      },
    });
    const out = styleOutput("Cashflow ni tight.", profile);
    expect(out.text.startsWith("Habari")).toBe(true);
  });

  it("low-confidence profile: no transformations applied", () => {
    const profile = makeDefaultProfile(owner);
    const out = styleOutput(LONG_TEXT, profile);
    expect(out.transformations).toHaveLength(0);
    expect(out.text).toBe(LONG_TEXT);
  });
});
