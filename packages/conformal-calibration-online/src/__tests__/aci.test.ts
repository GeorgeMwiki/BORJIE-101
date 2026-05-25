import { describe, expect, it } from "vitest";
import {
  applyBatch,
  conformalThresholdAt,
  createOnlineConformalState,
  currentAlpha,
  diagnostic,
  updateConformal,
} from "../aci.js";

function obs(predictedCovered: boolean): {
  predictedCovered: boolean;
  observedAtIso: string;
} {
  return { predictedCovered, observedAtIso: "2026-01-01T00:00:00Z" };
}

describe("createOnlineConformalState", () => {
  it("uses sensible defaults", () => {
    const s = createOnlineConformalState();
    expect(s.targetCoverage).toBe(0.9);
    expect(s.alpha).toBe(0.1);
    expect(s.learningRate).toBe(0.05);
    expect(s.windowSize).toBe(200);
    expect(s.recent).toEqual([]);
  });

  it("accepts config overrides", () => {
    const s = createOnlineConformalState({
      targetCoverage: 0.95,
      initialAlpha: 0.05,
      learningRate: 0.02,
      windowSize: 100,
    });
    expect(s.targetCoverage).toBe(0.95);
    expect(s.alpha).toBe(0.05);
    expect(s.windowSize).toBe(100);
  });
});

describe("updateConformal — single step", () => {
  it("appends the observation", () => {
    const s = createOnlineConformalState();
    const next = updateConformal(s, obs(true));
    expect(next.recent).toHaveLength(1);
  });

  it("does not mutate the input state", () => {
    const s = createOnlineConformalState();
    const before = JSON.parse(JSON.stringify(s));
    updateConformal(s, obs(true));
    expect(s).toEqual(before);
  });

  it("increases alpha when observed coverage > target", () => {
    let s = createOnlineConformalState({
      targetCoverage: 0.9,
      initialAlpha: 0.1,
      learningRate: 0.5,
    });
    for (let i = 0; i < 10; i += 1) s = updateConformal(s, obs(true));
    expect(s.alpha).toBeGreaterThan(0.1);
  });

  it("decreases alpha when observed coverage < target", () => {
    let s = createOnlineConformalState({
      targetCoverage: 0.9,
      initialAlpha: 0.1,
      learningRate: 0.5,
    });
    for (let i = 0; i < 10; i += 1) s = updateConformal(s, obs(false));
    expect(s.alpha).toBeLessThan(0.1);
  });

  it("respects alphaMin floor", () => {
    let s = createOnlineConformalState({
      initialAlpha: 0.05,
      learningRate: 10,
    });
    for (let i = 0; i < 5; i += 1)
      s = updateConformal(s, obs(false), { alphaMin: 0.01 });
    expect(s.alpha).toBeGreaterThanOrEqual(0.01);
  });

  it("respects alphaMax ceiling", () => {
    let s = createOnlineConformalState({
      initialAlpha: 0.45,
      learningRate: 10,
    });
    for (let i = 0; i < 5; i += 1)
      s = updateConformal(s, obs(true), { alphaMax: 0.5 });
    expect(s.alpha).toBeLessThanOrEqual(0.5);
  });
});

describe("updateConformal — window rotation", () => {
  it("drops oldest observation when window full", () => {
    let s = createOnlineConformalState({ windowSize: 3 });
    s = updateConformal(s, obs(true));
    s = updateConformal(s, obs(false));
    s = updateConformal(s, obs(true));
    s = updateConformal(s, obs(false));
    expect(s.recent).toHaveLength(3);
    expect(s.recent[0].predictedCovered).toBe(false);
  });
});

describe("applyBatch", () => {
  it("matches sequential updateConformal calls", () => {
    const init = createOnlineConformalState();
    const observations = [obs(true), obs(false), obs(true), obs(true)];
    let manual = init;
    for (const o of observations) manual = updateConformal(manual, o);
    const batched = applyBatch(init, observations);
    expect(batched.alpha).toBe(manual.alpha);
    expect(batched.recent.length).toBe(manual.recent.length);
  });
});

describe("currentAlpha", () => {
  it("returns the state alpha", () => {
    const s = createOnlineConformalState({ initialAlpha: 0.12 });
    expect(currentAlpha(s)).toBe(0.12);
  });
});

describe("diagnostic", () => {
  it("reports observedCoverage = target on empty window", () => {
    const d = diagnostic(createOnlineConformalState({ targetCoverage: 0.9 }));
    expect(d.observedCoverage).toBe(0.9);
    expect(d.windowFilled).toBe(0);
  });

  it("flags drift after enough observations and divergence", () => {
    let s = createOnlineConformalState({ targetCoverage: 0.9 });
    for (let i = 0; i < 50; i += 1) s = updateConformal(s, obs(false));
    const d = diagnostic(s);
    expect(d.drifting).toBe(true);
  });

  it("does not flag drift on a small window", () => {
    let s = createOnlineConformalState();
    s = updateConformal(s, obs(false));
    const d = diagnostic(s);
    expect(d.drifting).toBe(false);
  });
});

describe("conformalThresholdAt", () => {
  it("returns +Infinity on empty calibration set", () => {
    const s = createOnlineConformalState();
    expect(conformalThresholdAt(s, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns a quantile value on a sorted score vector", () => {
    const s = createOnlineConformalState({ initialAlpha: 0.1 });
    const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const t = conformalThresholdAt(s, scores);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it("higher alpha yields a smaller threshold", () => {
    const lowAlpha = createOnlineConformalState({ initialAlpha: 0.05 });
    const highAlpha = createOnlineConformalState({ initialAlpha: 0.5 });
    const scores = Array.from({ length: 100 }, (_, i) => i / 100);
    const tL = conformalThresholdAt(lowAlpha, scores);
    const tH = conformalThresholdAt(highAlpha, scores);
    expect(tH).toBeLessThan(tL);
  });
});
