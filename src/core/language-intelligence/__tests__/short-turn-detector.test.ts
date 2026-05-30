/**
 * Tests for the short-turn language detector.
 *
 * The detector targets turns of ≤ 5 tokens where the main vocab
 * detector struggles. We assert its contract (lang/confidence/
 * alternates) and the specific short-turn cases the brief calls out.
 */

import { describe, it, expect } from "vitest";
import { detect, isDialectLangCode } from "../short-turn-detector";

describe("short-turn-detector — base contract", () => {
  it("returns 'und' for empty input", () => {
    const r = detect("");
    expect(r.lang).toBe("und");
    expect(r.confidence).toBe(0);
    expect(r.alternates).toEqual([]);
  });

  it("returns the expected shape", () => {
    const r = detect("habari");
    expect(typeof r.lang).toBe("string");
    expect(typeof r.confidence).toBe("number");
    expect(Array.isArray(r.alternates)).toBe(true);
    // Confidence must be in [0, 1].
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

describe("short-turn-detector — Swahili", () => {
  it("detects 'habari' as sw", () => {
    const r = detect("habari");
    expect(r.lang).toBe("sw");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("detects 'ninahitaji mkopo' as sw with high confidence", () => {
    const r = detect("ninahitaji mkopo");
    expect(r.lang).toBe("sw");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("detects 'asante sana' (2 tokens) as sw", () => {
    const r = detect("asante sana");
    expect(r.lang).toBe("sw");
  });

  it("detects 'naomba' (1 token) as sw", () => {
    const r = detect("naomba");
    expect(r.lang).toBe("sw");
  });
});

describe("short-turn-detector — English", () => {
  it("detects 'loan' as en", () => {
    const r = detect("loan");
    expect(r.lang).toBe("en");
  });

  it("detects 'how much' as en", () => {
    const r = detect("how much");
    expect(r.lang).toBe("en");
  });

  it("detects 'check my balance' as en", () => {
    const r = detect("check my balance");
    expect(r.lang).toBe("en");
  });
});

describe("short-turn-detector — Tanzanian dialects", () => {
  it("detects Maa greeting 'supai' as mas-tz", () => {
    const r = detect("supai");
    expect(r.lang).toBe("mas-tz");
  });

  it("detects Sukuma greeting 'mwangaluka' as suk-tz", () => {
    const r = detect("mwangaluka");
    expect(r.lang).toBe("suk-tz");
  });

  it("detects Chaga 'mbege' as cha-tz", () => {
    const r = detect("mbege");
    expect(r.lang).toBe("cha-tz");
  });

  it("detects Hehe greeting 'kamwene' as heh-tz", () => {
    const r = detect("kamwene");
    expect(r.lang).toBe("heh-tz");
  });

  it("detects Haya greeting 'agandi' as hay-tz", () => {
    const r = detect("agandi");
    expect(r.lang).toBe("hay-tz");
  });
});

describe("short-turn-detector — alternates ranking", () => {
  it("returns at least one alternate when both EN and SW signals fire", () => {
    const r = detect("loan mkopo");
    // Whichever wins, the runner-up should appear in alternates.
    expect(r.alternates.length).toBeGreaterThanOrEqual(1);
    const langs = new Set([r.lang, ...r.alternates.map((a) => a.lang)]);
    expect(langs.has("sw")).toBe(true);
    expect(langs.has("en")).toBe(true);
  });
});

describe("isDialectLangCode (type guard)", () => {
  it("identifies dialect codes", () => {
    expect(isDialectLangCode("mas-tz")).toBe(true);
    expect(isDialectLangCode("suk-tz")).toBe(true);
    expect(isDialectLangCode("bez-tz")).toBe(true);
  });

  it("rejects non-dialect codes", () => {
    expect(isDialectLangCode("sw")).toBe(false);
    expect(isDialectLangCode("en")).toBe(false);
    expect(isDialectLangCode("und")).toBe(false);
    expect(isDialectLangCode("fr")).toBe(false);
  });
});
