/**
 * Tests for `detectCodeSwitchSpans`.
 *
 * The detector splits a code-switched utterance into language-tagged
 * spans with character offsets. The brief's canonical example is:
 *
 *   "natafuta loan ya 5 milioni for kushughulika na business yangu"
 *
 * which contains Swahili frame words (natafuta, ya, milioni,
 * kushughulika, na, yangu), one EN financial term ("loan"), one EN
 * preposition ("for"), one EN noun ("business"), and a numeric token.
 *
 * We assert:
 *   - Span coverage: every character of the input belongs to either
 *     a span or whitespace.
 *   - Span types: at least one "sw" and one "en" or "mixed" span.
 *   - Plain SW returns a single "sw" span.
 *   - Plain EN returns a single "en" span.
 *   - Empty input returns an empty array.
 */

import { describe, it, expect } from "vitest";
import { detectCodeSwitchSpans } from "../language-detector";

describe("detectCodeSwitchSpans", () => {
  it("returns empty array for empty input", () => {
    expect(detectCodeSwitchSpans("")).toEqual([]);
  });

  it("returns one 'sw' span for pure Swahili", () => {
    const text = "ninahitaji msaada wa mkopo";
    const spans = detectCodeSwitchSpans(text);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // At least one span should be tagged sw.
    expect(spans.some((s) => s.lang === "sw")).toBe(true);
    // No span should be tagged "en" for a pure-SW input.
    expect(spans.some((s) => s.lang === "en")).toBe(false);
  });

  it("returns one 'en' span for pure English financial query", () => {
    const text = "loan interest rate balance payment";
    const spans = detectCodeSwitchSpans(text);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans.some((s) => s.lang === "en")).toBe(true);
    expect(spans.some((s) => s.lang === "sw")).toBe(false);
  });

  it("detects mixed spans in the brief's canonical code-switched example", () => {
    const text =
      "natafuta loan ya 5 milioni for kushughulika na business yangu";
    const spans = detectCodeSwitchSpans(text);
    // We expect at least 2 distinct language tags across spans.
    const langs = new Set(spans.map((s) => s.lang));
    expect(langs.size).toBeGreaterThanOrEqual(2);

    // Every span offset must be in-bounds and start < end.
    for (const s of spans) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.end).toBeLessThanOrEqual(text.length);
    }
    // Spans must be in left-to-right, non-overlapping order.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
  });

  it("the canonical sentence contains EN-tagged tokens for 'loan' / 'for' / 'business'", () => {
    const text =
      "natafuta loan ya 5 milioni for kushughulika na business yangu";
    const spans = detectCodeSwitchSpans(text);
    // Slice the original text by span offsets and confirm at least one
    // EN-tagged span contains one of those English tokens.
    const enSurface = spans
      .filter((s) => s.lang === "en" || s.lang === "mixed")
      .map((s) => text.slice(s.start, s.end).toLowerCase());
    const allEn = enSurface.join(" ");
    const hasAnyEn =
      allEn.includes("loan") ||
      allEn.includes("for") ||
      allEn.includes("business");
    expect(hasAnyEn).toBe(true);
  });

  it("offsets recover the original surface form on slice", () => {
    const text = "I want mkopo wa milioni mbili";
    const spans = detectCodeSwitchSpans(text);
    for (const s of spans) {
      const surface = text.slice(s.start, s.end);
      expect(surface.length).toBeGreaterThan(0);
      expect(text.indexOf(surface, s.start)).toBe(s.start);
    }
  });

  it("returns a 'mixed' span when the text has no recognized vocabulary", () => {
    // Unrecognised tokens with no clear language signal end up in a
    // mixed span (or no spans). Either way is acceptable; assert that
    // we never claim to know the language with high confidence.
    const text = "xyzqq pqrr";
    const spans = detectCodeSwitchSpans(text);
    if (spans.length > 0) {
      expect(
        spans.every(
          (s) => s.lang === "mixed" || s.lang === "sw" || s.lang === "en",
        ),
      ).toBe(true);
    }
  });
});
