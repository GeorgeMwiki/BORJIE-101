import { describe, expect, it } from "vitest";
import { etag, etagMatches, normaliseETag } from "../etag.js";

describe("etag", () => {
  it("produces a stable hash for the same object", () => {
    const a = { x: 1, y: 2 };
    expect(etag(a)).toBe(etag(a));
  });

  it("produces the same hash regardless of key insertion order", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    expect(etag(a)).toBe(etag(b));
  });

  it("produces different hashes for different objects", () => {
    expect(etag({ x: 1 })).not.toBe(etag({ x: 2 }));
  });

  it("uses W/ weak-validator prefix", () => {
    expect(etag({ a: 1 })).toMatch(/^W\/".*"$/);
  });
});

describe("normaliseETag", () => {
  it("preserves W/-prefixed input", () => {
    expect(normaliseETag('W/"abc"')).toBe('W/"abc"');
  });

  it("wraps quoted-only input with W/", () => {
    expect(normaliseETag('"abc"')).toBe('W/"abc"');
  });

  it("wraps bare input with W/ + quotes", () => {
    expect(normaliseETag("abc")).toBe('W/"abc"');
  });

  it("preserves *", () => {
    expect(normaliseETag("*")).toBe("*");
  });
});

describe("etagMatches", () => {
  it("matches identical W/-prefixed forms", () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
  });

  it("matches bare vs W/-prefixed", () => {
    expect(etagMatches("abc", 'W/"abc"')).toBe(true);
  });

  it("does not match different ETags", () => {
    expect(etagMatches('W/"abc"', 'W/"def"')).toBe(false);
  });

  it("* matches anything", () => {
    expect(etagMatches("*", 'W/"abc"')).toBe(true);
  });
});
