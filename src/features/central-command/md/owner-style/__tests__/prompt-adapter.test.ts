import { describe, it, expect } from "vitest";
import { adaptPrompt, buildStyleDirective } from "../prompt-adapter";
import {
  makeDefaultProfile,
  type OwnerStyleProfile,
} from "../style-dimensions";

const owner = {
  tenantId: "t",
  ownerUserId: "u",
  now: () => "2026-05-17T00:00:00.000Z",
};

function makeProfile(overrides: Partial<OwnerStyleProfile>): OwnerStyleProfile {
  const base = makeDefaultProfile(owner);
  return { ...base, ...overrides };
}

describe("prompt-adapter", () => {
  it("falls back to neutral directive when confidence is too low", () => {
    const profile = makeDefaultProfile(owner);
    const directive = buildStyleDirective(profile);
    expect(directive).toContain("neutral, professional voice");
  });

  it("snapshot: high-confidence directive, casual + terse + directive owner", () => {
    const profile = makeProfile({
      tone: {
        value: "casual",
        weights: { casual: 9, formal: 1, collegial: 1, coach_like: 1 },
        confidence: 0.75,
      },
      verbosity: {
        value: "terse",
        weights: { terse: 9, balanced: 1, verbose: 1 },
        confidence: 0.81,
      },
      decisionStyle: {
        value: "directive",
        weights: { directive: 9, collaborative: 1, consultative: 1 },
        confidence: 0.81,
      },
    });
    const directive = buildStyleDirective(profile);
    expect(directive).toMatchSnapshot();
  });

  it("snapshot: collaborative, verbose, swahili-leaning bilingual", () => {
    const profile = makeProfile({
      verbosity: {
        value: "verbose",
        weights: { terse: 1, balanced: 1, verbose: 9 },
        confidence: 0.81,
      },
      decisionStyle: {
        value: "collaborative",
        weights: { directive: 1, collaborative: 9, consultative: 1 },
        confidence: 0.81,
      },
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
    const directive = buildStyleDirective(profile);
    expect(directive).toMatchSnapshot();
  });

  it("snapshot: conservative + finance-led + email", () => {
    const profile = makeProfile({
      riskAppetite: {
        value: "conservative",
        weights: { conservative: 9, moderate: 1, aggressive: 1 },
        confidence: 0.81,
      },
      domainPriorities: {
        value: "finance_led",
        weights: {
          sales_led: 1,
          ops_led: 1,
          people_led: 1,
          finance_led: 9,
          balanced: 1,
        },
        confidence: 0.69,
      },
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
    const directive = buildStyleDirective(profile);
    expect(directive).toMatchSnapshot();
  });

  it("adaptPrompt appends directive to system prompt and leaves user unchanged", () => {
    const profile = makeProfile({
      verbosity: {
        value: "terse",
        weights: { terse: 9, balanced: 1, verbose: 1 },
        confidence: 0.81,
      },
    });
    const out = adaptPrompt(
      { system: "You are the MD.", user: "What should I do about cashflow?" },
      profile,
    );
    expect(out.system).toContain("You are the MD.");
    expect(out.system).toContain("OWNER-STYLE DIRECTIVE");
    expect(out.system).toContain("Be terse");
    expect(out.user).toBe("What should I do about cashflow?");
    expect(out.styleDirective).toContain("Be terse");
  });

  it("low confidence on a dimension is excluded from the directive", () => {
    const profile = makeProfile({
      tone: {
        value: "casual",
        weights: { casual: 1.1, formal: 1, collegial: 1, coach_like: 1 },
        confidence: 0.27,
      },
      verbosity: {
        value: "terse",
        weights: { terse: 9, balanced: 1, verbose: 1 },
        confidence: 0.81,
      },
    });
    const directive = buildStyleDirective(profile);
    expect(directive).not.toContain("casual");
    expect(directive).toContain("terse");
  });
});
