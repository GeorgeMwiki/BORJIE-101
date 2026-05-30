import { describe, expect, it } from "vitest";

import { computeRice, scoreRice } from "../rice-scorer";
import { sampleCandidate } from "./fixtures";

describe("rice-scorer", () => {
  describe("computeRice — Intercom canonical examples", () => {
    it("computes RICE for Intercom's worked example", () => {
      // Reach 500, Impact 3 (= "high"), Confidence 0.8, Effort 4 months -> 300
      // Using Intercom's 1..3 impact scale here for parity. RICE = 500*3*0.8/4
      expect(computeRice(500, 3, 0.8, 4)).toBeCloseTo(300, 3);
    });

    it("scales linearly in reach", () => {
      expect(computeRice(100, 5, 0.8, 2)).toBeCloseTo(200, 3);
      expect(computeRice(200, 5, 0.8, 2)).toBeCloseTo(400, 3);
    });

    it("scales inversely with effort", () => {
      const big = computeRice(100, 5, 0.8, 1);
      const small = computeRice(100, 5, 0.8, 4);
      expect(big).toBeCloseTo(small * 4, 3);
    });

    it("floors effort at 0.1 to avoid division by zero", () => {
      expect(Number.isFinite(computeRice(10, 5, 0.5, 0))).toBe(true);
      expect(computeRice(10, 5, 0.5, 0)).toBeCloseTo(250, 3);
    });
  });

  describe("scoreRice", () => {
    it("uses reach * impact * confidence / effort", () => {
      // reach 100, impact 7+1=8, conf 0.7+0.1=0.8, effort 2 => 100*8*0.8/2 = 320
      const out = scoreRice(sampleCandidate);
      expect(out.rice).toBeCloseTo(320, 3);
    });

    it("returns an immutable result", () => {
      expect(Object.isFrozen(scoreRice(sampleCandidate))).toBe(true);
    });
  });
});
