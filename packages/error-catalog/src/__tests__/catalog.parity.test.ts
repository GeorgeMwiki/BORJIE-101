import { describe, it, expect } from "vitest";
import { ERROR_MESSAGES } from "../messages.js";
import { GENERIC_FALLBACK } from "../fallback.js";
import { localizeApiError, hasLocalizedError } from "../localize.js";
import gatewayCodes from "../__fixtures__/gateway-error-codes.json";
import genericByDesign from "../__fixtures__/generic-by-design.json";

/**
 * Codes whose en/sw copy is intentionally identical because the term is a
 * proper noun / brand that is NOT translated (none today). Keep empty unless a
 * real same-word-both-locales entry is added; this prevents the passthrough
 * guard from being a false alarm while still biting on accidental EN leakage.
 */
const ALLOWED_SAME_STRING = new Set<string>([]);

describe("error-catalog parity", () => {
  const entries = Object.entries(ERROR_MESSAGES);

  it("has at least the known user-reachable 4xx families", () => {
    expect(entries.length).toBeGreaterThan(150);
  });

  it("every entry has a non-empty en AND sw value (complete parity)", () => {
    for (const [code, msg] of entries) {
      expect(msg.en, `${code}.en must be non-empty`).toBeTruthy();
      expect(msg.en.trim().length, `${code}.en must be non-empty`).toBeGreaterThan(0);
      expect(msg.sw, `${code}.sw must be non-empty`).toBeTruthy();
      expect(msg.sw.trim().length, `${code}.sw must be non-empty`).toBeGreaterThan(0);
    }
  });

  it("no accidental sw === en passthrough on a translatable code", () => {
    for (const [code, msg] of entries) {
      if (ALLOWED_SAME_STRING.has(code)) continue;
      expect(
        msg.sw.trim().toLowerCase(),
        `${code}: sw must not equal en (untranslated passthrough = language mixing under sw)`,
      ).not.toBe(msg.en.trim().toLowerCase());
    }
  });

  it("keys are valid UPPER_SNAKE codes", () => {
    for (const [code] of entries) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("the generic fallback itself is complete and distinct per locale", () => {
    expect(GENERIC_FALLBACK.en.trim().length).toBeGreaterThan(0);
    expect(GENERIC_FALLBACK.sw.trim().length).toBeGreaterThan(0);
    expect(GENERIC_FALLBACK.sw.toLowerCase()).not.toBe(GENERIC_FALLBACK.en.toLowerCase());
  });
});

describe("error-catalog coverage ratchet", () => {
  const catalogKeys = new Set(Object.keys(ERROR_MESSAGES));
  const allowlist = new Set<string>(genericByDesign.codes);
  const userReachable: string[] = gatewayCodes.userReachable;

  it("every emitted user-reachable 4xx code is localized OR explicitly generic-by-design", () => {
    const uncovered = userReachable.filter(
      (code) => !catalogKeys.has(code) && !allowlist.has(code),
    );
    expect(
      uncovered,
      `These gateway user-reachable codes have neither catalog copy nor a generic-by-design allowlist entry: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("the generic-by-design allowlist contains no code that already has catalog copy (shrink-only hygiene)", () => {
    const redundant = [...allowlist].filter((code) => catalogKeys.has(code));
    expect(redundant, `allowlisted but also localized: ${redundant.join(", ")}`).toEqual([]);
  });

  it("no catalog entry duplicates an infra (5xx) code that should use the generic fallback", () => {
    const infra = new Set<string>(gatewayCodes.infra);
    const leaked = [...catalogKeys].filter((code) => infra.has(code));
    expect(leaked, `infra codes wrongly given bespoke copy: ${leaked.join(", ")}`).toEqual([]);
  });
});

describe("localizeApiError helper", () => {
  it("returns localized copy for a known code (object envelope)", () => {
    expect(localizeApiError({ code: "FORBIDDEN", message: "You are not allowed" }, "en")).toBe(
      ERROR_MESSAGES.FORBIDDEN!.en,
    );
    expect(localizeApiError({ code: "FORBIDDEN" }, "sw")).toBe(ERROR_MESSAGES.FORBIDDEN!.sw);
  });

  it("accepts a raw code string", () => {
    expect(localizeApiError("VALIDATION", "sw")).toBe(ERROR_MESSAGES.VALIDATION!.sw);
  });

  it("normalizes case/whitespace of the code", () => {
    expect(localizeApiError("  forbidden  ", "en")).toBe(ERROR_MESSAGES.FORBIDDEN!.en);
  });

  it("returns the generic localized fallback for an unknown code — NEVER a raw English message", () => {
    const out = localizeApiError({ code: "TOTALLY_UNKNOWN_CODE", message: "Raw English leak" }, "sw");
    expect(out).toBe(GENERIC_FALLBACK.sw);
    expect(out).not.toContain("Raw English leak");
  });

  it("returns the generic localized fallback for a 5xx-infra code", () => {
    const infraCode = gatewayCodes.infra[0] as string;
    expect(localizeApiError(infraCode, "sw")).toBe(GENERIC_FALLBACK.sw);
    expect(localizeApiError(infraCode, "en")).toBe(GENERIC_FALLBACK.en);
  });

  it("returns the generic fallback for null/undefined/empty input", () => {
    expect(localizeApiError(null, "en")).toBe(GENERIC_FALLBACK.en);
    expect(localizeApiError(undefined, "sw")).toBe(GENERIC_FALLBACK.sw);
    expect(localizeApiError("", "sw")).toBe(GENERIC_FALLBACK.sw);
    expect(localizeApiError({}, "en")).toBe(GENERIC_FALLBACK.en);
  });

  it("hasLocalizedError reflects catalog coverage", () => {
    expect(hasLocalizedError("FORBIDDEN")).toBe(true);
    expect(hasLocalizedError("TOTALLY_UNKNOWN_CODE")).toBe(false);
    expect(hasLocalizedError(null)).toBe(false);
  });
});
