import { describe, it, expect } from "vitest";
import {
  bandForTimestamp,
  extractEvidence,
  updateProfile,
  updateProfileBatch,
  type ChatTurnObservation,
} from "../profiler";
import { makeDefaultProfile } from "../style-dimensions";

const owner = { tenantId: "t-1", ownerUserId: "u-1" } as const;
const FIXED_NOW = () => "2026-05-17T10:00:00.000Z";

function baseProfile() {
  return makeDefaultProfile({ ...owner, now: FIXED_NOW });
}

function turn(
  text: string,
  ts = "2026-05-17T09:00:00.000Z",
  extras: Partial<ChatTurnObservation> = {},
): ChatTurnObservation {
  return { text, timestamp: ts, ...extras };
}

describe("profiler — Bayesian update", () => {
  it("starts with uniform prior and zero sample size", () => {
    const p = baseProfile();
    expect(p.sampleSize).toBe(0);
    expect(p.tone.confidence).toBeCloseTo(0.25, 5); // 4 tone categories
    expect(p.verbosity.confidence).toBeCloseTo(1 / 3, 5);
  });

  it("a single terse observation increases terse weight strictly", () => {
    const before = baseProfile();
    const after = updateProfile(before, turn("ok"), { now: FIXED_NOW });
    expect(after.verbosity.weights.terse).toBeGreaterThan(
      before.verbosity.weights.terse,
    );
    expect(after.verbosity.value).toBe("terse");
    expect(after.sampleSize).toBe(1);
  });

  it("verbose observation shifts headline value to verbose", () => {
    const before = baseProfile();
    const longText = Array.from({ length: 80 }).fill("word").join(" ");
    const after = updateProfile(before, turn(longText), { now: FIXED_NOW });
    expect(after.verbosity.value).toBe("verbose");
  });

  it("does NOT mutate the input profile (immutability)", () => {
    const before = baseProfile();
    const snapshot = JSON.stringify(before);
    updateProfile(before, turn("ok"), { now: FIXED_NOW });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("multiple consistent observations strictly raise confidence on that category", () => {
    let p = baseProfile();
    const conf0 = p.verbosity.confidence;
    for (let i = 0; i < 5; i++) {
      p = updateProfile(p, turn("ok"), { now: FIXED_NOW });
    }
    expect(p.verbosity.value).toBe("terse");
    expect(p.verbosity.confidence).toBeGreaterThan(conf0);
  });

  it("decay is applied — older observations weight less than fresh ones", () => {
    let p = baseProfile();
    // Five aggressive turns first
    for (let i = 0; i < 5; i++) {
      p = updateProfile(
        p,
        turn("we should scale fast and double down — aggressive bet"),
        { now: FIXED_NOW, decay: 0.5 },
      );
    }
    const aggrWeight = p.riskAppetite.weights.aggressive ?? 0;
    expect(aggrWeight).toBeGreaterThan(1);
    // Then five conservative turns with the same heavy decay
    for (let i = 0; i < 5; i++) {
      p = updateProfile(
        p,
        turn("be safe, cautious, avoid risk and minimise risk"),
        { now: FIXED_NOW, decay: 0.5 },
      );
    }
    expect(p.riskAppetite.value).toBe("conservative");
    // Heavy decay means old aggressive weight has been crushed
    expect(p.riskAppetite.weights.aggressive).toBeLessThan(
      p.riskAppetite.weights.conservative,
    );
  });

  it("negative reaction down-weights evidence", () => {
    const before = baseProfile();
    const neutral = updateProfile(
      before,
      turn("we should scale fast and double down"),
      {
        now: FIXED_NOW,
      },
    );
    const negative = updateProfile(
      before,
      turn("we should scale fast and double down", "2026-05-17T09:00:00.000Z", {
        reaction: -1,
      }),
      { now: FIXED_NOW },
    );
    expect(negative.riskAppetite.weights.aggressive).toBeLessThan(
      neutral.riskAppetite.weights.aggressive,
    );
  });

  it("positive reaction amplifies evidence", () => {
    const before = baseProfile();
    const neutral = updateProfile(before, turn("we should scale fast"), {
      now: FIXED_NOW,
    });
    const positive = updateProfile(
      before,
      turn("we should scale fast", "2026-05-17T09:00:00.000Z", { reaction: 1 }),
      { now: FIXED_NOW },
    );
    expect(positive.riskAppetite.weights.aggressive).toBeGreaterThan(
      neutral.riskAppetite.weights.aggressive,
    );
  });

  it("captures time-of-day patterns", () => {
    let p = baseProfile();
    // Five morning observations
    for (let i = 0; i < 5; i++) {
      p = updateProfile(p, turn("hi", "2026-05-17T09:00:00.000Z"), {
        now: FIXED_NOW,
      });
    }
    expect(p.timeOfDayPatterns.peakBand).toBe("morning");
    expect(p.timeOfDayPatterns.sampleSize).toBe(5);
  });

  it("language: heavy swahili token ratio shifts language preference", () => {
    let p = baseProfile();
    for (let i = 0; i < 3; i++) {
      p = updateProfile(p, turn("habari asante tafadhali biashara sawa"), {
        now: FIXED_NOW,
      });
    }
    expect(p.languagePreference.value).toBe("swahili_only");
  });

  it("batch update applies turns in order", () => {
    const before = baseProfile();
    const turns = [
      turn("ok"),
      turn("just do it"),
      turn("aggressive bet — scale fast"),
    ];
    const after = updateProfileBatch(before, turns, { now: FIXED_NOW });
    expect(after.sampleSize).toBe(3);
    expect(after.decisionStyle.value).toBe("directive");
    expect(after.riskAppetite.value).toBe("aggressive");
  });

  it("aggregate confidence is the average of dimension confidences", () => {
    let p = baseProfile();
    for (let i = 0; i < 10; i++) {
      p = updateProfile(p, turn("ok — just do it"), { now: FIXED_NOW });
    }
    expect(p.confidence).toBeGreaterThan(0.25);
    expect(p.confidence).toBeLessThanOrEqual(1);
  });

  it("rejects invalid turn silently", () => {
    const before = baseProfile();
    const bad = { text: 123, timestamp: 456 } as unknown as ChatTurnObservation;
    const after = updateProfile(before, bad, { now: FIXED_NOW });
    expect(after).toBe(before);
  });

  it("extractEvidence yields votes per dimension for a rich turn", () => {
    const ev = extractEvidence(
      turn(
        "let's discuss — what do you think about scaling sales aggressively? thanks",
      ),
    );
    expect(ev.decisionStyle?.collaborative).toBeGreaterThan(0);
    expect(ev.tone?.collegial).toBeGreaterThan(0);
    expect(ev.domainPriorities?.sales_led).toBeGreaterThan(0);
  });

  it("bandForTimestamp maps known hours", () => {
    expect(bandForTimestamp("2026-05-17T05:00:00.000Z")).toBe("early_morning");
    expect(bandForTimestamp("2026-05-17T10:00:00.000Z")).toBe("morning");
    expect(bandForTimestamp("2026-05-17T14:00:00.000Z")).toBe("afternoon");
    expect(bandForTimestamp("2026-05-17T18:00:00.000Z")).toBe("evening");
    expect(bandForTimestamp("2026-05-17T22:00:00.000Z")).toBe("night");
  });
});
