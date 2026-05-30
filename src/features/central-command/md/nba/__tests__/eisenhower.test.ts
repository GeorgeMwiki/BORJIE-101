import { describe, expect, it } from "vitest";

import {
  EISENHOWER_THRESHOLDS,
  classifyByScores,
  classifyEisenhower,
} from "../eisenhower";
import { sampleCandidate } from "./fixtures";

describe("eisenhower", () => {
  it("classifies urgent + important as do-now", () => {
    expect(classifyByScores(9, 9)).toBe("do-now");
  });

  it("classifies important not urgent as schedule", () => {
    expect(classifyByScores(2, 9)).toBe("schedule");
  });

  it("classifies urgent not important as delegate", () => {
    expect(classifyByScores(9, 3)).toBe("delegate");
  });

  it("classifies neither as drop", () => {
    expect(classifyByScores(2, 3)).toBe("drop");
  });

  it("uses inclusive threshold boundaries", () => {
    const t = EISENHOWER_THRESHOLDS;
    expect(classifyByScores(t.urgent, t.important)).toBe("do-now");
  });

  it("classifyEisenhower applies lifts to baselines", () => {
    // baseline impact 7 + lift 1 = 8 (important), urgency 5 (not urgent)
    const out = classifyEisenhower(sampleCandidate);
    expect(out.importanceScore).toBe(8);
    expect(out.urgencyScore).toBe(5);
    expect(out.quadrant).toBe("schedule");
  });
});
