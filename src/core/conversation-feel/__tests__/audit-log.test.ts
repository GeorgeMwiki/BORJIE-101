import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetAuditLog,
  appendIntervention,
  listInterventions,
  verifyChain,
  setSessionStats,
  getSessionStats,
  aggregateChatbotFeelScore,
} from "../audit-log";

describe("audit-log", () => {
  beforeEach(() => _resetAuditLog());

  it("appends and lists interventions", () => {
    appendIntervention({
      id: "a",
      guard: "g",
      outcome: "silent_fix",
      reason: "r",
      before: "b",
      after: "a",
      created_at: new Date().toISOString(),
      session_id: "s1",
    });
    expect(listInterventions("s1")).toHaveLength(1);
  });

  it("hash-chains records and verifyChain returns ok", () => {
    appendIntervention({
      id: "a",
      guard: "g",
      outcome: "silent_fix",
      reason: "r",
      before: "x",
      after: "y",
      created_at: "2026-05-07T00:00:00Z",
      session_id: "s2",
    });
    appendIntervention({
      id: "b",
      guard: "g",
      outcome: "annotate",
      reason: "r2",
      before: "y",
      after: "y",
      created_at: "2026-05-07T00:00:01Z",
      session_id: "s2",
    });
    const v = verifyChain("s2");
    expect(v.ok).toBe(true);
  });

  it("session stats round-trip", () => {
    setSessionStats({
      session_id: "s3",
      anti_pattern_strips: 1,
      continuity_enforcements: 0,
      position_taking_interventions: 0,
      sycophancy_pushbacks: 0,
      brevity_violations: 0,
      specificity_fixes: 0,
      honest_uncertainty_invocations: 0,
      wit_uses: 0,
      rhythm: {
        variance: 0,
        question_back_ratio: 0,
        pause_signals: 0,
        flatlined: false,
        turns_analyzed: 0,
      },
      chatbot_feel_score: 12,
    });
    expect(getSessionStats("s3")?.chatbot_feel_score).toBe(12);
    expect(aggregateChatbotFeelScore()).toBe(12);
  });
});
