/**
 * Rate Limit — in-memory fallback path tests.
 *
 * Redis path is exercised separately in integration tests; here we lock down
 * the deterministic in-process behaviour that protects dev / CI / cold-boot.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetInMemoryTrackerForTests,
  canRefreshOnDemand,
} from "../rate-limit";

beforeEach(() => {
  _resetInMemoryTrackerForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("canRefreshOnDemand (in-memory fallback)", () => {
  it("permits the first 3 calls in a window for the same actor + factKey", async () => {
    expect(await canRefreshOnDemand("user-123", "vat_rate")).toBe(true);
    expect(await canRefreshOnDemand("user-123", "vat_rate")).toBe(true);
    expect(await canRefreshOnDemand("user-123", "vat_rate")).toBe(true);
  });

  it("blocks the 4th call within the window", async () => {
    for (let i = 0; i < 3; i++) {
      await canRefreshOnDemand("user-123", "vat_rate");
    }
    expect(await canRefreshOnDemand("user-123", "vat_rate")).toBe(false);
  });

  it("isolates buckets per actor", async () => {
    for (let i = 0; i < 3; i++) {
      await canRefreshOnDemand("user-123", "vat_rate");
    }
    expect(await canRefreshOnDemand("user-456", "vat_rate")).toBe(true);
  });

  it("isolates buckets per factKey", async () => {
    for (let i = 0; i < 3; i++) {
      await canRefreshOnDemand("user-123", "vat_rate");
    }
    expect(await canRefreshOnDemand("user-123", "corp_tax_rate")).toBe(true);
  });

  it("sanitizes injection-y characters in actor + factKey without throwing", async () => {
    const result = await canRefreshOnDemand(
      "user-123:DROP TABLE truth_claims;",
      "vat_rate; rm -rf /",
    );
    expect(typeof result).toBe("boolean");
  });
});
