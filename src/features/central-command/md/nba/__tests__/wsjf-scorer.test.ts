import { describe, expect, it } from "vitest";

import { computeWsjf, scoreWsjf } from "../wsjf-scorer";
import { sampleCandidate } from "./fixtures";

describe("wsjf-scorer", () => {
  describe("computeWsjf — SAFe canonical formula", () => {
    it("matches the SAFe textbook example", () => {
      // SAFe: CoD = (UBV + TC + RR) = 8 + 5 + 3 = 16; Job size 4
      // WSJF = 16 / 4 = 4
      expect(computeWsjf(8, 5, 3, 4)).toBeCloseTo(4, 3);
    });

    it("prefers shorter jobs at equal CoD", () => {
      const longer = computeWsjf(8, 5, 3, 8);
      const shorter = computeWsjf(8, 5, 3, 2);
      expect(shorter).toBeGreaterThan(longer);
    });

    it("floors job size at 0.1", () => {
      expect(Number.isFinite(computeWsjf(5, 5, 5, 0))).toBe(true);
    });

    it("clamps each component to its legal range", () => {
      // 12 -> 10, 11 -> 10, 15 -> 10, job size 1 -> CoD 30, wsjf 30
      expect(computeWsjf(12, 11, 15, 1)).toBeCloseTo(30, 3);
    });
  });

  describe("scoreWsjf", () => {
    it("derives CoD from impact+urgency+confidence*10", () => {
      // ubv = 7+1=8, time=5, rr = (0.7+0.1)*10 = 8 -> CoD 21, jobSize 2 -> wsjf 10.5
      const out = scoreWsjf(sampleCandidate);
      expect(out.userBusinessValue).toBe(8);
      expect(out.timeCriticality).toBe(5);
      expect(out.riskReductionOpportunityEnablement).toBeCloseTo(8, 3);
      expect(out.costOfDelay).toBeCloseTo(21, 3);
      expect(out.wsjf).toBeCloseTo(10.5, 3);
    });

    it("is immutable", () => {
      expect(Object.isFrozen(scoreWsjf(sampleCandidate))).toBe(true);
    });
  });
});
