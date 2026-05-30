/**
 * MD core - system prompt snapshot.
 *
 * Snapshots the canonical blocks so unreviewed prompt drift fails CI.
 */

import { describe, it, expect } from "vitest";

import { buildMdSystemPrompt, MD_SYSTEM_PROMPT_BLOCKS } from "../system-prompt";

describe("buildMdSystemPrompt", () => {
  it("includes the identity, tone, frameworks, autonomy, governance blocks", () => {
    const prompt = buildMdSystemPrompt({
      orgName: "Acme Coffee Ltd",
      tier: "org-admin",
      ownerName: "Asha",
      businessTagline: "specialty coffee roaster, 12 staff",
      ownerPosture: "data-driven",
    });
    expect(prompt).toContain("Managing Director");
    expect(prompt).toContain("senior consultant");
    expect(prompt).toContain("ICE");
    expect(prompt).toContain("RICE");
    expect(prompt).toContain("Eisenhower");
    expect(prompt).toContain("OKR");
    expect(prompt).toContain("Hoshin Kanri");
    expect(prompt).toContain("autonomy ladder");
    expect(prompt).toContain("DecisionTrace");
    expect(prompt).toContain("Acme Coffee Ltd");
    expect(prompt).toContain("data-driven");
  });

  it("excludes em dashes (style invariant)", () => {
    const prompt = buildMdSystemPrompt({
      orgName: "Anything",
      tier: "org-admin",
    });
    expect(prompt).not.toContain("—");
  });

  it("exposes named blocks", () => {
    expect(MD_SYSTEM_PROMPT_BLOCKS.identity).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.tone).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.frameworks).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.proactivity).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.autonomy).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.governance).toBeTypeOf("string");
    expect(MD_SYSTEM_PROMPT_BLOCKS.output).toBeTypeOf("string");
  });

  // Wave 8 — jurisdiction-aware block.
  describe("jurisdiction block", () => {
    it("omits the jurisdiction block when none is supplied", () => {
      const prompt = buildMdSystemPrompt({
        orgName: "Anything",
        tier: "org-admin",
      });
      expect(prompt).not.toContain("Jurisdiction context");
    });

    it("cites the regulator + currency + APR cap when jurisdiction is supplied", () => {
      const prompt = buildMdSystemPrompt({
        orgName: "Acme Lend Ltd",
        tier: "org-admin",
        jurisdiction: {
          code: "TZ",
          name: "Tanzania",
          currency: "TZS",
          aprCap: 0.24,
          regulators: ["BoT", "TRA", "BRELA"],
        },
      });
      expect(prompt).toContain("Jurisdiction context");
      expect(prompt).toContain("Tanzania (TZ)");
      expect(prompt).toContain("TZS");
      expect(prompt).toContain("24.0%");
      expect(prompt).toContain("BoT");
    });

    it("says 'no statutory APR cap' when aprCap is null", () => {
      const prompt = buildMdSystemPrompt({
        orgName: "x",
        tier: "org-admin",
        jurisdiction: {
          code: "US",
          name: "United States",
          currency: "USD",
          aprCap: null,
        },
      });
      expect(prompt).toContain("no statutory APR cap");
    });

    it("warns against defaulting to TZ/US framings", () => {
      const prompt = buildMdSystemPrompt({
        orgName: "x",
        tier: "org-admin",
        jurisdiction: {
          code: "KE",
          name: "Kenya",
          currency: "KES",
          aprCap: null,
        },
      });
      expect(prompt).toContain("Never default to Tanzanian or US framings");
    });
  });
});
