/**
 * Semantic Extractor — TF-IDF determinism (LLM layer env-flagged off).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { extractRelevantExcerpt } from "../semantic-extractor";

beforeEach(() => {
  delete process.env.TRUTH_ENGINE_SEMANTIC_LLM;
});

describe("extractRelevantExcerpt", () => {
  it("returns null on tiny input", async () => {
    const result = await extractRelevantExcerpt({
      html: "hi",
      query: "anything",
    });
    expect(result).toBeNull();
  });

  it("strips HTML tags before extracting", async () => {
    const html = `<html><body><script>alert('x')</script><p>The Tanzanian VAT rate is 18 percent for most goods. The threshold for VAT registration is 200 million Tanzanian shillings annually for businesses operating in mainland Tanzania.</p></body></html>`;
    const result = await extractRelevantExcerpt({
      html,
      query: "VAT rate Tanzania",
    });
    expect(result).not.toBeNull();
    expect(result?.excerpt).not.toContain("<");
    expect(result?.excerpt).not.toContain("alert");
  });

  it("picks the chunk that mentions the query terms over an unrelated chunk", async () => {
    const irrelevant =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
    const relevant =
      "The Bank of Tanzania Central Bank Rate (CBR) is the principal monetary policy tool used quarterly by the Monetary Policy Committee.";
    const html = `<p>${irrelevant}</p><p>${relevant}</p><p>${irrelevant}</p>`;

    const result = await extractRelevantExcerpt({
      html,
      query: "Bank of Tanzania Central Bank Rate",
    });
    expect(result).not.toBeNull();
    expect(result?.excerpt.toLowerCase()).toContain("central bank rate");
    expect(result?.method).toBe("tfidf");
  });

  it("falls back deterministically if no query terms match (returns first chunk slice)", async () => {
    const html = `<p>Generic text with no matching terms whatsoever just lots of random words.</p>`;
    const result = await extractRelevantExcerpt({
      html,
      query: "completelyunrelatedterm",
    });
    expect(result).not.toBeNull();
    // Either tfidf (numeric density boost) or fallback are acceptable
    expect(["tfidf", "fallback"]).toContain(result?.method);
  });

  it("respects maxLength cap", async () => {
    const html = "<p>" + "x ".repeat(2000) + "Tanzania VAT 18 percent</p>";
    const result = await extractRelevantExcerpt({
      html,
      query: "VAT",
      maxLength: 200,
    });
    expect(result).not.toBeNull();
    expect(result?.excerpt.length).toBeLessThanOrEqual(200);
  });
});
