import { describe, it, expect } from "vitest";
import {
  inferInitialProfile,
  lexicalClassifier,
  type StyleClassifier,
} from "../style-inferrer";

const owner = { tenantId: "t-1", ownerUserId: "u-1" };
const NOW = () => "2026-05-17T10:00:00.000Z";

const fiveTurns = [
  {
    text: "Just do it. We need to scale fast.",
    timestamp: "2026-05-17T07:00:00.000Z",
  },
  {
    text: "Aggressive bet — double down on sales.",
    timestamp: "2026-05-17T07:05:00.000Z",
  },
  { text: "ok", timestamp: "2026-05-17T07:10:00.000Z" },
  { text: "go ahead", timestamp: "2026-05-17T07:15:00.000Z" },
  { text: "execute", timestamp: "2026-05-17T07:20:00.000Z" },
];

describe("style-inferrer", () => {
  it("with no turns returns the default profile", async () => {
    const profile = await inferInitialProfile({
      ...owner,
      turns: [],
      now: NOW,
    });
    expect(profile.sampleSize).toBe(0);
    expect(profile.verbosity.value).toBe("balanced");
  });

  it("with 5 directive+aggressive turns infers directive + aggressive", async () => {
    const profile = await inferInitialProfile({
      ...owner,
      turns: fiveTurns,
      now: NOW,
    });
    expect(profile.decisionStyle.value).toBe("directive");
    expect(profile.riskAppetite.value).toBe("aggressive");
    expect(profile.sampleSize).toBe(5);
  });

  it("classifier injection wins over lexicon when it disagrees", async () => {
    const classifier: StyleClassifier = {
      async classify() {
        return {
          tone: { formal: 50 },
          verbosity: { verbose: 50 },
        };
      },
    };
    const profile = await inferInitialProfile({
      ...owner,
      turns: fiveTurns,
      classifier,
      now: NOW,
    });
    expect(profile.tone.value).toBe("formal");
    expect(profile.verbosity.value).toBe("verbose");
  });

  it("classifier failure falls back to lexicon profiler", async () => {
    const failing: StyleClassifier = {
      async classify() {
        throw new Error("network down");
      },
    };
    const profile = await inferInitialProfile({
      ...owner,
      turns: fiveTurns,
      classifier: failing,
      now: NOW,
    });
    expect(profile.sampleSize).toBe(5);
    expect(profile.decisionStyle.value).toBe("directive");
  });

  it("lexicalClassifier aggregates votes deterministically", async () => {
    const out = await lexicalClassifier.classify(fiveTurns);
    expect(out.decisionStyle?.directive).toBeGreaterThan(0);
    expect(out.riskAppetite?.aggressive).toBeGreaterThan(0);
  });
});
