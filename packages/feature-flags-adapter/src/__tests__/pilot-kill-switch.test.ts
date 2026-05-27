/**
 * Pilot kill-switch unit tests.
 *
 * Asserts:
 *   1. Default state is OFF (pilot disabled) when no signals are set —
 *      this is the guard against accidental deploys exposing pilot
 *      endpoints on a fresh environment.
 *   2. `PILOT_KILL_SWITCH_OPEN=true` always wins, even when the DB-backed
 *      flag says ON.
 *   3. DB-backed feature flag enables the pilot when the tenant matches.
 *   4. `PILOT_ENABLED=true` env opt-in works as a fallback when no flag
 *      adapter is wired.
 *   5. Cohort + userId are forwarded to the flag adapter as attributes.
 *   6. The canonical 503 response carries bilingual sw/en wording.
 */

import { describe, expect, it } from "vitest";
import {
  isPilotEnabled,
  isPilotKillSwitchOpen,
  isPilotEnvOptIn,
  PILOT_KILL_SWITCH_RESPONSE,
  PILOT_ENABLED_FLAG,
} from "../pilot-kill-switch.js";
import { createInMemoryAdapter } from "../in-memory-adapter.js";
import type { FeatureFlagsPort, FlagContext } from "../types.js";

describe("isPilotKillSwitchOpen", () => {
  it("returns false when env var is absent", () => {
    expect(isPilotKillSwitchOpen({})).toBe(false);
  });

  it("returns true for truthy variants", () => {
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "true" })).toBe(true);
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "1" })).toBe(true);
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "YES" })).toBe(true);
  });

  it("treats empty / whitespace / unknown values as false", () => {
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "" })).toBe(false);
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "   " })).toBe(false);
    expect(isPilotKillSwitchOpen({ PILOT_KILL_SWITCH_OPEN: "maybe" })).toBe(false);
  });
});

describe("isPilotEnvOptIn", () => {
  it("defaults to false so accidental deploys do not expose pilot", () => {
    expect(isPilotEnvOptIn({})).toBe(false);
  });

  it("returns true when PILOT_ENABLED is truthy", () => {
    expect(isPilotEnvOptIn({ PILOT_ENABLED: "true" })).toBe(true);
  });
});

describe("isPilotEnabled — precedence + fallbacks", () => {
  it("returns false by default (no signals, no adapter)", async () => {
    const result = await isPilotEnabled(
      { tenantId: "tnt-1" },
      { env: {} },
    );
    expect(result).toBe(false);
  });

  it("returns true when the DB-backed flag says ON for the tenant", async () => {
    const adapter = createInMemoryAdapter({
      flags: { [PILOT_ENABLED_FLAG]: { enabled: true } },
    });
    const result = await isPilotEnabled(
      { tenantId: "tnt-1" },
      { featureFlags: adapter, env: {} },
    );
    expect(result).toBe(true);
  });

  it("returns false even if flag is ON when emergency kill-switch is tripped", async () => {
    const adapter = createInMemoryAdapter({
      flags: { [PILOT_ENABLED_FLAG]: { enabled: true } },
    });
    const result = await isPilotEnabled(
      { tenantId: "tnt-1" },
      {
        featureFlags: adapter,
        env: { PILOT_KILL_SWITCH_OPEN: "true" },
      },
    );
    expect(result).toBe(false);
  });

  it("falls back to PILOT_ENABLED env when flag adapter is absent", async () => {
    const result = await isPilotEnabled(
      { tenantId: "tnt-1" },
      { env: { PILOT_ENABLED: "true" } },
    );
    expect(result).toBe(true);
  });

  it("falls back to PILOT_ENABLED env when flag says OFF (dev convenience)", async () => {
    const adapter = createInMemoryAdapter({
      flags: { [PILOT_ENABLED_FLAG]: { enabled: false } },
    });
    const result = await isPilotEnabled(
      { tenantId: "tnt-1" },
      { featureFlags: adapter, env: { PILOT_ENABLED: "true" } },
    );
    expect(result).toBe(true);
  });

  it("honours per-tenant allow-list inside the flag adapter", async () => {
    const adapter = createInMemoryAdapter({
      flags: {
        [PILOT_ENABLED_FLAG]: {
          enabled: true,
          allowedTenants: ["tnt-pilot-1"],
        },
      },
    });
    const allowed = await isPilotEnabled(
      { tenantId: "tnt-pilot-1" },
      { featureFlags: adapter, env: {} },
    );
    const blocked = await isPilotEnabled(
      { tenantId: "tnt-other" },
      { featureFlags: adapter, env: {} },
    );
    expect(allowed).toBe(true);
    expect(blocked).toBe(false);
  });

  it("forwards cohort + userId as attributes/context to the flag adapter", async () => {
    const captured: FlagContext[] = [];
    const spyAdapter: FeatureFlagsPort = {
      async isEnabled(_flag: string, context: FlagContext): Promise<boolean> {
        captured.push(context);
        return false;
      },
      async getVariant(): Promise<string> {
        return "control";
      },
      async getAllFlags(): Promise<readonly never[]> {
        return [];
      },
    };
    await isPilotEnabled(
      { tenantId: "tnt-1", cohort: "pilot-tz-may-2026", userId: "usr-7" },
      { featureFlags: spyAdapter, env: {} },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.tenantId).toBe("tnt-1");
    expect(captured[0]?.userId).toBe("usr-7");
    expect(captured[0]?.attributes?.cohort).toBe("pilot-tz-may-2026");
  });
});

describe("PILOT_KILL_SWITCH_RESPONSE — bilingual envelope", () => {
  it("exposes Swahili and English wording in the canonical body", () => {
    expect(PILOT_KILL_SWITCH_RESPONSE.success).toBe(false);
    expect(PILOT_KILL_SWITCH_RESPONSE.error.code).toBe("PILOT_PAUSED");
    expect(PILOT_KILL_SWITCH_RESPONSE.error.message_sw.length).toBeGreaterThan(20);
    expect(PILOT_KILL_SWITCH_RESPONSE.error.message_en.length).toBeGreaterThan(20);
    expect(PILOT_KILL_SWITCH_RESPONSE.error.message_sw).toMatch(/Borjie/i);
    expect(PILOT_KILL_SWITCH_RESPONSE.error.message_en.toLowerCase()).toContain("pilot");
  });

  it("is deep-frozen so call sites cannot mutate the canonical body", () => {
    expect(Object.isFrozen(PILOT_KILL_SWITCH_RESPONSE)).toBe(true);
    expect(Object.isFrozen(PILOT_KILL_SWITCH_RESPONSE.error)).toBe(true);
  });
});
