import { describe, expect, it } from "vitest";

import {
  generateCandidates,
  rankCandidates,
  findLowHangingFruit,
  findHighImpact,
  LOW_HANGING_FRUIT_THRESHOLDS,
  HIGH_IMPACT_THRESHOLD,
} from "../index";
import { stressedSnapshot } from "./fixtures";

function rankFor(snapshot = stressedSnapshot) {
  const candidates = generateCandidates(snapshot);
  return rankCandidates(candidates, snapshot);
}

describe("findLowHangingFruit", () => {
  it("only returns actions above the ease + impact floors", () => {
    const ranked = rankFor();
    const fruit = findLowHangingFruit(ranked, 10);
    expect(fruit.length).toBeGreaterThan(0);
    for (const f of fruit) {
      expect(f.ice.ease).toBeGreaterThanOrEqual(
        LOW_HANGING_FRUIT_THRESHOLDS.ease,
      );
      expect(f.ice.impact).toBeGreaterThanOrEqual(
        LOW_HANGING_FRUIT_THRESHOLDS.impact,
      );
    }
  });

  it("limit defaults to 5", () => {
    const ranked = rankFor();
    expect(findLowHangingFruit(ranked).length).toBeLessThanOrEqual(5);
  });

  it("returns an empty array when nothing qualifies", () => {
    const fruit = findLowHangingFruit([], 5);
    expect(fruit).toEqual([]);
  });
});

describe("findHighImpact", () => {
  it("only returns actions with impact >= threshold", () => {
    const ranked = rankFor();
    const hi = findHighImpact(ranked, 10);
    expect(hi.length).toBeGreaterThan(0);
    for (const a of hi) {
      expect(a.ice.impact).toBeGreaterThanOrEqual(HIGH_IMPACT_THRESHOLD);
    }
  });

  it("orders by impact * confidence desc", () => {
    const ranked = rankFor();
    const hi = findHighImpact(ranked, 10);
    for (let i = 1; i < hi.length; i += 1) {
      const a = hi[i - 1].ice.impact * hi[i - 1].ice.confidence;
      const b = hi[i].ice.impact * hi[i].ice.confidence;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});
