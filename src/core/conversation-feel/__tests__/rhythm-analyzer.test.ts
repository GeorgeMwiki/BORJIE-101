import { describe, it, expect } from "vitest";
import { analyzeRhythm, rhythmInjection } from "../style-audit/rhythm-analyzer";
import type { RecentTurn } from "../types";

const a = (n: number, words: number, extra = ""): RecentTurn => ({
  role: "assistant",
  content: Array.from({ length: words }).fill("word").join(" ") + " " + extra,
  turn_index: n,
});

describe("rhythm-analyzer", () => {
  it("returns zero score on empty history", () => {
    const r = analyzeRhythm([]);
    expect(r.turns_analyzed).toBe(0);
    expect(r.flatlined).toBe(false);
  });

  it("flatlines on uniform-length non-question replies without pauses", () => {
    const turns: RecentTurn[] = [a(0, 30), a(1, 30), a(2, 30), a(3, 30)];
    const r = analyzeRhythm(turns);
    expect(r.flatlined).toBe(true);
    expect(rhythmInjection(r)).not.toBeNull();
  });

  it("does not flatline when variance is high", () => {
    const turns: RecentTurn[] = [a(0, 5), a(1, 80), a(2, 12), a(3, 50)];
    const r = analyzeRhythm(turns);
    expect(r.flatlined).toBe(false);
  });

  it("does not flatline when assistant asks a question back", () => {
    const turns: RecentTurn[] = [
      a(0, 30),
      a(1, 30),
      { role: "assistant", content: "Did you mean 12 months?", turn_index: 2 },
    ];
    const r = analyzeRhythm(turns);
    expect(r.flatlined).toBe(false);
    expect(r.question_back_ratio).toBeGreaterThan(0);
  });

  it("counts pause signals", () => {
    const turns: RecentTurn[] = [
      {
        role: "assistant",
        content: "Hmm, let me check that...",
        turn_index: 0,
      },
      a(1, 30),
    ];
    const r = analyzeRhythm(turns);
    expect(r.pause_signals).toBeGreaterThanOrEqual(1);
  });
});
