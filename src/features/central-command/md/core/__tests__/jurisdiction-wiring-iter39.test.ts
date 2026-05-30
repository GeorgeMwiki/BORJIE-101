/**
 * iter-39 jurisdiction-wiring regression.
 *
 * Locks the contract: jurisdiction resolved by the chat route flows
 * through MdTurnInput into the system-prompt builder, and the
 * resulting prompt contains the regulator-aware block.
 *
 *   - MdTurnInputSchema accepts jurisdiction (zod validation)
 *   - MdTurnInputSchema rejects malformed jurisdiction
 *   - renderMdSystemPromptFromTurn includes the jurisdiction block
 *     when input has it
 *   - renderMdSystemPromptFromTurn omits the block when input has
 *     none (jurisdiction-agnostic fallback)
 *   - regulator labels (BoT / CFPB / FCA) round-trip into the prompt
 */

import { describe, it, expect } from "vitest";
import { MdTurnInputSchema, type MdTurnInput } from "../types";
import { renderMdSystemPromptFromTurn } from "../orchestrator";

const baseTurn: MdTurnInput = {
  orgId: "org-1",
  ownerId: "owner-1",
  sessionId: "sess-1",
  correlationId: "corr-1",
  tier: "org-admin",
  text: "morning briefing",
  portalId: "admin",
  route: "/api/central-command/md/chat",
};

describe("MdTurnInputSchema — jurisdiction", () => {
  it("accepts the optional jurisdiction block", () => {
    const parsed = MdTurnInputSchema.parse({
      ...baseTurn,
      jurisdiction: {
        code: "TZ",
        name: "Tanzania",
        currency: "TZS",
        aprCap: 0.36,
        regulators: ["BoT", "CRB"],
      },
    });
    expect(parsed.jurisdiction?.code).toBe("TZ");
    expect(parsed.jurisdiction?.regulators).toEqual(["BoT", "CRB"]);
  });

  it("accepts an absent jurisdiction (the wave-8 default path)", () => {
    const parsed = MdTurnInputSchema.parse(baseTurn);
    expect(parsed.jurisdiction).toBeUndefined();
  });

  it("rejects an empty code", () => {
    expect(() =>
      MdTurnInputSchema.parse({
        ...baseTurn,
        jurisdiction: {
          code: "",
          name: "Tanzania",
          currency: "TZS",
          aprCap: null,
        },
      }),
    ).toThrow();
  });

  it("rejects a non-numeric aprCap", () => {
    expect(() =>
      MdTurnInputSchema.parse({
        ...baseTurn,
        jurisdiction: {
          code: "TZ",
          name: "Tanzania",
          currency: "TZS",
          aprCap: "high" as unknown as number,
        },
      }),
    ).toThrow();
  });

  it("accepts null aprCap (no statutory ceiling)", () => {
    const parsed = MdTurnInputSchema.parse({
      ...baseTurn,
      jurisdiction: {
        code: "US",
        name: "United States",
        currency: "USD",
        aprCap: null,
        regulators: ["CFPB"],
      },
    });
    expect(parsed.jurisdiction?.aprCap).toBeNull();
  });
});

describe("renderMdSystemPromptFromTurn", () => {
  it("includes the jurisdiction block when input has one", () => {
    const turn: MdTurnInput = {
      ...baseTurn,
      jurisdiction: {
        code: "TZ",
        name: "Tanzania",
        currency: "TZS",
        aprCap: 0.36,
        regulators: ["BoT", "CRB"],
      },
    };
    const prompt = renderMdSystemPromptFromTurn({
      turn,
      orgName: "Acme Credit Tanzania",
    });
    expect(prompt).toContain("Tanzania");
    expect(prompt).toContain("TZS");
    expect(prompt).toContain("36.0%");
    expect(prompt).toContain("BoT, CRB");
  });

  it("omits the jurisdiction block when input has none", () => {
    const prompt = renderMdSystemPromptFromTurn({
      turn: baseTurn,
      orgName: "Acme",
    });
    expect(prompt).not.toContain("Jurisdiction context");
    expect(prompt).not.toContain("statutory APR ceiling");
  });

  it("handles null aprCap correctly (no statutory ceiling phrase)", () => {
    const turn: MdTurnInput = {
      ...baseTurn,
      jurisdiction: {
        code: "US",
        name: "United States",
        currency: "USD",
        aprCap: null,
        regulators: ["CFPB"],
      },
    };
    const prompt = renderMdSystemPromptFromTurn({
      turn,
      orgName: "Acme US",
    });
    expect(prompt).toContain("no statutory APR cap");
    expect(prompt).toContain("CFPB");
  });

  it("propagates the tier from MdTurnInput", () => {
    const turn: MdTurnInput = { ...baseTurn, tier: "borrower" };
    const prompt = renderMdSystemPromptFromTurn({
      turn,
      orgName: "Acme",
    });
    expect(prompt).toContain("Caller tier: borrower");
  });
});
