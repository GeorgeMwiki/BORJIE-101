/**
 * Circuit Breaker — state-transition tests.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  breakerKeyForUrl,
  canAttempt,
  recordFailure,
  recordSuccess,
  resetBreaker,
  withBreaker,
} from "../circuit-breaker";

const KEY = "test.example.com";

describe("breakerKeyForUrl", () => {
  it("normalizes hostname to lowercase, strips www", () => {
    expect(breakerKeyForUrl("https://WWW.bot.go.tz/path")).toBe("bot.go.tz");
    expect(breakerKeyForUrl("https://demo-bank.test")).toBe("demo-bank.test");
  });

  it("returns invalid_url sentinel on parse failure", () => {
    expect(breakerKeyForUrl("not a url")).toBe("invalid_url");
  });
});

describe("circuit breaker state machine", () => {
  beforeEach(() => {
    resetBreaker(KEY);
    vi.useRealTimers();
  });

  it("starts closed and allows calls", () => {
    expect(canAttempt(KEY)).toBe(true);
  });

  it("opens after 5 failures within window", () => {
    for (let i = 0; i < 5; i++) recordFailure(KEY);
    expect(canAttempt(KEY)).toBe(false);
  });

  it("half-opens after cooldown elapses, then closes on success", () => {
    vi.useFakeTimers();
    const start = new Date("2026-04-30T00:00:00Z").getTime();
    vi.setSystemTime(start);

    for (let i = 0; i < 5; i++) recordFailure(KEY);
    expect(canAttempt(KEY)).toBe(false);

    // Move past the cooldown window (120s)
    vi.setSystemTime(start + 121_000);
    expect(canAttempt(KEY)).toBe(true); // transition to half_open

    // Success while half_open closes the breaker
    recordSuccess(KEY);
    expect(canAttempt(KEY)).toBe(true);
  });

  it("re-opens immediately if a probe fails in half_open", () => {
    vi.useFakeTimers();
    const start = new Date("2026-04-30T00:00:00Z").getTime();
    vi.setSystemTime(start);

    for (let i = 0; i < 5; i++) recordFailure(KEY);
    vi.setSystemTime(start + 121_000);
    expect(canAttempt(KEY)).toBe(true); // half_open probe allowed

    recordFailure(KEY); // probe fails
    expect(canAttempt(KEY)).toBe(false);
  });

  it("ages out old failures so an isolated burst doesn't open the breaker", () => {
    vi.useFakeTimers();
    const start = new Date("2026-04-30T00:00:00Z").getTime();
    vi.setSystemTime(start);

    for (let i = 0; i < 4; i++) recordFailure(KEY);
    // Move past sliding window (60s) — old failures expire
    vi.setSystemTime(start + 61_000);
    recordFailure(KEY); // only 1 failure in current window
    expect(canAttempt(KEY)).toBe(true);
  });
});

describe("withBreaker", () => {
  beforeEach(() => resetBreaker("withbreaker.host"));

  it("returns the operation result on success", async () => {
    const result = await withBreaker("withbreaker.host", async () => 42);
    expect(result).toBe(42);
  });

  it("propagates the underlying error after recording failure", async () => {
    await expect(
      withBreaker("withbreaker.host", async () => {
        throw new Error("upstream_500");
      }),
    ).rejects.toThrow("upstream_500");
  });

  it("short-circuits with circuit_breaker_open after threshold failures", async () => {
    for (let i = 0; i < 5; i++) {
      await withBreaker("withbreaker.host", async () => {
        throw new Error("upstream_500");
      }).catch(() => undefined);
    }
    await expect(
      withBreaker("withbreaker.host", async () => 1),
    ).rejects.toThrow(/circuit_breaker_open/);
  });
});
