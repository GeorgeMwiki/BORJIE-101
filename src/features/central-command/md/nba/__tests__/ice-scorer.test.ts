import { describe, expect, it } from "vitest";

import { clamp, computeIce, round, scoreIce } from "../ice-scorer";
import { sampleCandidate } from "./fixtures";

describe("ice-scorer", () => {
  describe("computeIce", () => {
    it("matches the canonical Sean Ellis formula", () => {
      // From Sean Ellis ICE: 8 * 0.8 * 7 = 44.8
      expect(computeIce(8, 0.8, 7)).toBeCloseTo(44.8, 3);
    });

    it("returns 0 when any factor is 0", () => {
      expect(computeIce(0, 0.9, 9)).toBe(0);
      expect(computeIce(10, 0, 10)).toBe(0);
      expect(computeIce(10, 1, 0)).toBe(0);
    });

    it("hits the 100 ceiling at max values", () => {
      expect(computeIce(10, 1, 10)).toBe(100);
    });

    it("clamps values outside the legal range", () => {
      // 12 -> 10, 1.4 -> 1, 11 -> 10 => 10 * 1 * 10 = 100
      expect(computeIce(12, 1.4, 11)).toBe(100);
      // -3 -> 0, 0.5, 5 -> 0
      expect(computeIce(-3, 0.5, 5)).toBe(0);
    });
  });

  describe("scoreIce", () => {
    it("applies contextual lifts to baseline", () => {
      const score = scoreIce(sampleCandidate);
      // impact 7+1=8, conf 0.7+0.1=0.8, ease 8 => 8 * 0.8 * 8 = 51.2
      expect(score.impact).toBe(8);
      expect(score.confidence).toBeCloseTo(0.8, 3);
      expect(score.ease).toBe(8);
      expect(score.ice).toBeCloseTo(51.2, 3);
    });

    it("returns a frozen, immutable score object", () => {
      const score = scoreIce(sampleCandidate);
      expect(Object.isFrozen(score)).toBe(true);
    });

    it("does not mutate its input", () => {
      const before = JSON.stringify(sampleCandidate);
      scoreIce(sampleCandidate);
      expect(JSON.stringify(sampleCandidate)).toBe(before);
    });
  });

  describe("clamp", () => {
    it("respects bounds", () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(11, 0, 10)).toBe(10);
    });

    it("returns lo for NaN", () => {
      expect(clamp(Number.NaN, 0, 10)).toBe(0);
    });
  });

  describe("round", () => {
    it("rounds to requested decimals", () => {
      expect(round(1.23456, 2)).toBe(1.23);
      expect(round(1.235, 2)).toBe(1.24);
    });
  });
});
